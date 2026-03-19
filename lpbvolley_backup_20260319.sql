--
-- PostgreSQL database dump
--

\restrict UgrCv8Kn2Lu8o2fbweR2E2sgVYsgh7KYcShUBGuGGD40c0odOJgqblPtZARezvt

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: approve_player_request(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.approve_player_request(p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_req    player_requests%ROWTYPE;
  v_pid    UUID;
  v_reg    JSONB;
BEGIN
  SELECT * INTO v_req FROM player_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_processed');
  END IF;

  -- Создаём игрока
  INSERT INTO players (name, gender, phone, status)
  VALUES (v_req.name, v_req.gender, v_req.phone, 'active')
  ON CONFLICT (lower(trim(name)), gender) DO UPDATE SET status = 'active'
  RETURNING id INTO v_pid;

  -- Обновляем заявку
  UPDATE player_requests
     SET status = 'approved',
         approved_player_id = v_pid,
         reviewed_at = now()
   WHERE id = p_request_id;

  -- Если указан турнир — пробуем зарегистрировать
  IF v_req.tournament_id IS NOT NULL THEN
    v_reg := safe_register_player(v_req.tournament_id, v_pid);
    RETURN jsonb_build_object(
      'ok', true,
      'player_id', v_pid,
      'registration', v_reg
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'player_id', v_pid);
END;
$$;


ALTER FUNCTION public.approve_player_request(p_request_id uuid) OWNER TO postgres;

--
-- Name: create_room(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_room(p_room_code text, p_room_secret text, p_initial_state jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_CODE_REQUIRED', 'message', 'Укажите код комнаты');
  END IF;

  IF length(v_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Секрет комнаты должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO kotc_sessions (room_code, room_secret_hash, state)
    VALUES (v_code, room_secret_sha256(v_secret), coalesce(p_initial_state, '{}'::jsonb))
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'ok', true,
      'created', true,
      'room_code', v_row.room_code,
      'state', v_row.state,
      'updated_at', v_row.updated_at,
      'message', 'Комната создана'
    );
  END IF;

  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ROOM_SECRET_MISMATCH',
      'message', 'Неверный секрет комнаты'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', false,
    'room_code', v_row.room_code,
    'state', v_row.state,
    'updated_at', v_row.updated_at,
    'message', 'Комната подключена'
  );
END;
$$;


ALTER FUNCTION public.create_room(p_room_code text, p_room_secret text, p_initial_state jsonb) OWNER TO postgres;

--
-- Name: create_temporary_player(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_temporary_player(p_name text, p_gender text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_player  players%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  p_name := trim(coalesce(p_name, ''));
  IF p_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED', 'message', 'Укажите имя игрока');
  END IF;

  IF p_gender NOT IN ('M', 'W') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_GENDER', 'message', 'Пол должен быть M или W');
  END IF;

  BEGIN
    INSERT INTO players (name, gender, status)
    VALUES (p_name, p_gender, 'temporary')
    RETURNING * INTO v_player;
    v_created := true;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_player
        FROM players
       WHERE lower(trim(name)) = lower(p_name)
         AND gender = p_gender
       LIMIT 1;
  END;

  IF v_player.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PLAYER_NOT_FOUND', 'message', 'Не удалось создать профиль игрока');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'player', jsonb_build_object(
      'id', v_player.id,
      'name', v_player.name,
      'gender', v_player.gender,
      'status', v_player.status,
      'tournaments_played', v_player.tournaments_played,
      'total_pts', v_player.total_pts
    ),
    'message', CASE
      WHEN v_created THEN v_player.name || ' создан(а) как временный игрок'
      WHEN v_player.status = 'temporary' THEN v_player.name || ' уже есть как временный игрок'
      ELSE v_player.name || ' уже есть в базе'
    END
  );
END;
$$;


ALTER FUNCTION public.create_temporary_player(p_name text, p_gender text) OWNER TO postgres;

--
-- Name: get_public_leaderboard(text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_public_leaderboard(p_type text DEFAULT 'M'::text, p_limit integer DEFAULT 50) RETURNS TABLE(rank bigint, player_id uuid, name text, gender text, rating integer, tournaments integer, wins integer, last_seen date)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      CASE p_type
        WHEN 'W'   THEN p.rating_w
        WHEN 'Mix' THEN p.rating_mix
        ELSE            p.rating_m
      END DESC
    ) AS rank,
    p.id,
    p.name,
    p.gender,
    CASE p_type
      WHEN 'W'   THEN p.rating_w
      WHEN 'Mix' THEN p.rating_mix
      ELSE            p.rating_m
    END AS rating,
    CASE p_type
      WHEN 'W'   THEN p.tournaments_w
      WHEN 'Mix' THEN p.tournaments_mix
      ELSE            p.tournaments_m
    END AS tournaments,
    p.wins,
    p.last_seen
  FROM players p
  WHERE
    CASE p_type
      WHEN 'W'   THEN p.rating_w   > 0
      WHEN 'Mix' THEN p.rating_mix > 0
      ELSE            p.rating_m   > 0
    END
  ORDER BY rating DESC
  LIMIT p_limit;
$$;


ALTER FUNCTION public.get_public_leaderboard(p_type text, p_limit integer) OWNER TO postgres;

--
-- Name: get_public_tournament_history(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_public_tournament_history(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(t_data ORDER BY t_data->>'date' DESC)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',       t.id,
      'name',     t.name,
      'date',     t.date,
      'format',   t.format,
      'division', t.division,
      'top3',     (
        SELECT jsonb_agg(r_data ORDER BY (r_data->>'place')::INT)
        FROM (
          SELECT jsonb_build_object(
            'place',      tr.place,
            'name',       p.name,
            'gender',     p.gender,
            'game_pts',   tr.game_pts,
            'rating_pts', tr.rating_pts
            ,'wins',       tr.wins
            ,'diff',       tr.diff
            ,'coef',       tr.coef
            ,'balls',      tr.balls
          ) AS r_data
          FROM tournament_results tr
          JOIN players p ON p.id = tr.player_id
          WHERE tr.tournament_id = t.id
            AND tr.place <= 3
          ORDER BY tr.place
        ) sub
      )
    ) AS t_data
    FROM tournaments t
    WHERE t.status = 'finished'
      AND t.external_id IS NOT NULL
    ORDER BY t.date DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) sub2;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION public.get_public_tournament_history(p_limit integer, p_offset integer) OWNER TO postgres;

--
-- Name: get_room_state(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_room_state(p_room_code text, p_room_secret text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;

  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный секрет комнаты');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'room_code', v_row.room_code,
    'state', v_row.state,
    'updated_at', v_row.updated_at
  );
END;
$$;


ALTER FUNCTION public.get_room_state(p_room_code text, p_room_secret text) OWNER TO postgres;

--
-- Name: list_pending_requests(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.list_pending_requests(p_tournament_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, name text, gender text, phone text, tournament_id uuid, tournament_name text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
    SELECT
      pr.id,
      pr.name,
      pr.gender,
      pr.phone,
      pr.tournament_id,
      t.name AS tournament_name,
      pr.created_at
    FROM player_requests pr
    LEFT JOIN tournaments t ON t.id = pr.tournament_id
    WHERE pr.status = 'pending'
      AND (p_tournament_id IS NULL OR pr.tournament_id = p_tournament_id)
    ORDER BY pr.created_at ASC;
END;
$$;


ALTER FUNCTION public.list_pending_requests(p_tournament_id uuid) OWNER TO postgres;

--
-- Name: merge_players(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.merge_players(p_temp_id uuid, p_real_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_temp     players%ROWTYPE;
  v_real     players%ROWTYPE;
  v_moved    INT := 0;
  v_deleted  INT := 0;
  v_tp       RECORD;
BEGIN
  -- ① Блокируем оба профиля
  SELECT * INTO v_temp FROM players WHERE id = p_temp_id FOR UPDATE;
  SELECT * INTO v_real FROM players WHERE id = p_real_id FOR UPDATE;

  IF NOT FOUND OR v_temp.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'PLAYER_NOT_FOUND',
      'message', 'Один из игроков не найден');
  END IF;

  -- ② Проверки
  IF v_temp.id = v_real.id THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'SAME_PLAYER',
      'message', 'Нельзя склеить игрока с самим собой');
  END IF;

  IF v_temp.status <> 'temporary' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_TEMPORARY',
      'message', v_temp.name || ' не является временным игроком');
  END IF;

  -- ③ Переносим tournament_participants
  FOR v_tp IN
    SELECT * FROM tournament_participants
     WHERE player_id = p_temp_id
  LOOP
    -- Если real уже в этом турнире — удаляем запись temp (дубль)
    IF EXISTS (
      SELECT 1 FROM tournament_participants
       WHERE tournament_id = v_tp.tournament_id
         AND player_id     = p_real_id
    ) THEN
      DELETE FROM tournament_participants
       WHERE id = v_tp.id;
      v_deleted := v_deleted + 1;
    ELSE
      -- Переносим запись
      UPDATE tournament_participants
         SET player_id = p_real_id
       WHERE id = v_tp.id;
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  -- ④ Переносим player_requests
  UPDATE player_requests
     SET approved_player_id = p_real_id
   WHERE approved_player_id = p_temp_id;

  -- ⑤ Суммируем статистику
  UPDATE players
     SET tournaments_played = tournaments_played + v_temp.tournaments_played,
         total_pts          = total_pts + v_temp.total_pts
   WHERE id = p_real_id;

  -- ⑥ Аудит
  INSERT INTO merge_audit (temp_player_id, real_player_id, temp_name, real_name, records_moved)
  VALUES (p_temp_id, p_real_id, v_temp.name, v_real.name, v_moved);

  -- ⑦ Удаляем temp
  DELETE FROM players WHERE id = p_temp_id;

  RETURN jsonb_build_object(
    'ok',      true,
    'moved',   v_moved,
    'deleted', v_deleted,
    'message', 'Профиль «' || v_temp.name || '» склеен с «' || v_real.name
               || '». Перенесено записей: ' || v_moved
               || CASE WHEN v_deleted > 0 THEN ', дубликатов удалено: ' || v_deleted ELSE '' END
  );
END;
$$;


ALTER FUNCTION public.merge_players(p_temp_id uuid, p_real_id uuid) OWNER TO postgres;

--
-- Name: publish_tournament_results(text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.publish_tournament_results(p_external_id text, p_name text, p_date text, p_format text, p_division text, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_trn_id  UUID;
  v_rec     RECORD;
  v_player  players%ROWTYPE;
  v_count   INT := 0;
BEGIN
  -- ① Upsert турнир по external_id
  INSERT INTO tournaments (name, date, format, division, status, capacity, external_id)
  VALUES (
    trim(p_name),
    NULLIF(trim(p_date), '')::DATE,
    COALESCE(NULLIF(trim(p_format), ''), 'King of the Court'),
    COALESCE(NULLIF(trim(p_division), ''), 'Мужской'),
    'finished',
    jsonb_array_length(p_results),
    p_external_id
  )
  ON CONFLICT (external_id) DO UPDATE
    SET name   = EXCLUDED.name,
        date   = EXCLUDED.date,
        status = 'finished'
  RETURNING id INTO v_trn_id;

  -- Fallback если RETURNING не вернул (при DO UPDATE иногда)
  IF v_trn_id IS NULL THEN
    SELECT id INTO v_trn_id
      FROM tournaments
     WHERE external_id = p_external_id
     LIMIT 1;
  END IF;

  IF v_trn_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOURNAMENT_UPSERT_FAILED');
  END IF;

  -- ② Для каждого игрока: upsert профиль + upsert результат
  FOR v_rec IN
    SELECT *
    FROM jsonb_to_recordset(p_results) AS x(
      name              TEXT,
      gender            TEXT,
      place             INT,
      game_pts          INT,
      rating_pts        INT,
      rating_type       TEXT,
      rating_m          INT,
      rating_w          INT,
      rating_mix        INT,
      tournaments_m     INT,
      tournaments_w     INT,
      tournaments_mix   INT,
      wins              INT,
      last_seen         TEXT,
      total_pts         INT,
      tournaments_played INT
    )
  LOOP
    -- Upsert игрока. Функциональный индекс: lower(trim(name)), gender.
    -- При конфликте обновляем накопленную статистику (клиент прислал
    -- результат recalcAllPlayerStats — это достоверные актуальные данные).
    INSERT INTO players (
      name, gender, status,
      rating_m, rating_w, rating_mix,
      tournaments_m, tournaments_w, tournaments_mix,
      wins, last_seen, tournaments_played, total_pts
    )
    VALUES (
      trim(v_rec.name), v_rec.gender, 'active',
      COALESCE(v_rec.rating_m,  0),
      COALESCE(v_rec.rating_w,  0),
      COALESCE(v_rec.rating_mix,0),
      COALESCE(v_rec.tournaments_m,   0),
      COALESCE(v_rec.tournaments_w,   0),
      COALESCE(v_rec.tournaments_mix, 0),
      COALESCE(v_rec.wins, 0),
      CASE WHEN v_rec.last_seen IS NOT NULL AND v_rec.last_seen <> ''
           THEN v_rec.last_seen::DATE ELSE NULL END,
      COALESCE(v_rec.tournaments_played, 0),
      COALESCE(v_rec.total_pts, 0)
    )
    ON CONFLICT (lower(trim(name)), gender) DO UPDATE SET
      status            = 'active',
      rating_m          = EXCLUDED.rating_m,
      rating_w          = EXCLUDED.rating_w,
      rating_mix        = EXCLUDED.rating_mix,
      tournaments_m     = EXCLUDED.tournaments_m,
      tournaments_w     = EXCLUDED.tournaments_w,
      tournaments_mix   = EXCLUDED.tournaments_mix,
      wins              = EXCLUDED.wins,
      last_seen         = CASE
                            WHEN EXCLUDED.last_seen IS NOT NULL
                            THEN GREATEST(players.last_seen, EXCLUDED.last_seen)
                            ELSE players.last_seen
                          END,
      tournaments_played = EXCLUDED.tournaments_played,
      total_pts         = EXCLUDED.total_pts
    RETURNING * INTO v_player;

    -- Если RETURNING не сработал (крайне редко) — читаем явно
    IF v_player.id IS NULL THEN
      SELECT * INTO v_player FROM players
       WHERE lower(trim(name)) = lower(trim(v_rec.name))
         AND gender = v_rec.gender
       LIMIT 1;
    END IF;

    IF v_player.id IS NULL THEN CONTINUE; END IF;

    -- Upsert результата турнира
    INSERT INTO tournament_results
      (tournament_id, player_id, place, game_pts, rating_pts, gender, rating_type)
    VALUES
      (v_trn_id, v_player.id,
       v_rec.place,
       COALESCE(v_rec.game_pts,   0),
       COALESCE(v_rec.rating_pts, 0),
       v_rec.gender,
       COALESCE(NULLIF(v_rec.rating_type, ''), 'M'))
    ON CONFLICT (tournament_id, player_id) DO UPDATE SET
      place      = EXCLUDED.place,
      game_pts   = EXCLUDED.game_pts,
      rating_pts = EXCLUDED.rating_pts;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',            true,
    'tournament_id', v_trn_id,
    'results_saved', v_count
  );
END;
$$;


ALTER FUNCTION public.publish_tournament_results(p_external_id text, p_name text, p_date text, p_format text, p_division text, p_results jsonb) OWNER TO postgres;

--
-- Name: publish_tournament_results_thai32_server_compute(text, text, text, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.publish_tournament_results_thai32_server_compute(p_external_id text, p_name text, p_date text, p_format text, p_division text, p_results jsonb, p_raw_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_trn_id   UUID;
  v_rec      RECORD;
  v_player   players%ROWTYPE;
  v_count    INT := 0;

  v_scores     JSONB := p_raw_results->'scores';
  v_roster     JSONB := p_raw_results->'roster';
  v_div_scores JSONB := p_raw_results->'divScores';
  v_div_roster JSONB := p_raw_results->'divRoster';

  -- loop vars
  v_gender   TEXT;
  v_div_key  TEXT;
  v_ci        INT;
  v_mi        INT;
  v_wi        INT;
  v_ri        INT;
  v_nd        INT;

  -- per-player accumulators
  v_name   TEXT;
  v_own    INT;
  v_opp    INT;
  v_dif    INT;
  v_wins   INT;
  v_diff   INT;
  v_pts    INT;
  v_balls  INT;

  v_oppmi  INT;
  v_manidx INT;
  v_oppman INT;

  -- server computed values for current v_rec
  v_place      INT;
  v_game_pts   INT;
  v_rating_pts INT;
  v_wins_out   INT;
  v_diff_out   INT;
  v_coef_out   NUMERIC;
  v_balls_out  INT;
BEGIN
  -- ① Upsert tournament
  INSERT INTO tournaments (name, date, format, division, status, capacity, external_id)
  VALUES (
    trim(p_name),
    NULLIF(trim(p_date), '')::DATE,
    COALESCE(NULLIF(trim(p_format), ''), 'King of the Court'),
    COALESCE(NULLIF(trim(p_division), ''), 'Мужской'),
    'finished',
    jsonb_array_length(p_results),
    p_external_id
  )
  ON CONFLICT (external_id) DO UPDATE
    SET name   = EXCLUDED.name,
        date   = EXCLUDED.date,
        status = 'finished'
  RETURNING id INTO v_trn_id;

  IF v_trn_id IS NULL THEN
    SELECT id INTO v_trn_id
      FROM tournaments
     WHERE external_id = p_external_id
     LIMIT 1;
  END IF;

  IF v_trn_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOURNAMENT_UPSERT_FAILED');
  END IF;

  -- ② Compute combined totals from raw JSON
  CREATE TEMP TABLE tmp_thai32_totals (
    gender TEXT NOT NULL,
    name   TEXT NOT NULL,
    wins   INT  NOT NULL DEFAULT 0,
    diff   INT  NOT NULL DEFAULT 0,
    pts    INT  NOT NULL DEFAULT 0,
    balls  INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (gender, name)
  ) ON COMMIT DROP;

  -- R1: scores[ci][mi][ri] + perfect opponent mapping
  FOREACH v_gender IN ARRAY ARRAY['M','W'] LOOP
    FOR v_ci IN 0..3 LOOP
      FOR v_mi IN 0..3 LOOP
        -- resolve player name from roster
        IF v_gender = 'M' THEN
          v_name := (v_roster #>> ARRAY[v_ci::text, 'men', v_mi::text]);
        ELSE
          v_name := (v_roster #>> ARRAY[v_ci::text, 'women', v_mi::text]);
        END IF;

        IF v_name IS NULL OR trim(v_name) = '' THEN
          CONTINUE;
        END IF;

        v_wins  := 0;
        v_diff  := 0;
        v_pts   := 0;
        v_balls := 0;

        FOR v_ri IN 0..3 LOOP
          IF v_gender = 'M' THEN
            v_own := (v_scores #>> ARRAY[v_ci::text, v_mi::text, v_ri::text])::INT;
            v_oppmi := thai32_ipt_opp_idx(v_mi, v_ri);
            v_opp := CASE
              WHEN v_oppmi IS NULL THEN NULL
              ELSE (v_scores #>> ARRAY[v_ci::text, v_oppmi::text, v_ri::text])::INT
            END;
          ELSE
            v_manidx := thai32_partner_m(v_mi, v_ri); -- man index partnerM(wi,ri)
            v_own := (v_scores #>> ARRAY[v_ci::text, v_manidx::text, v_ri::text])::INT;
            v_oppman := thai32_ipt_opp_idx(v_manidx, v_ri);
            v_opp := CASE
              WHEN v_oppman IS NULL THEN NULL
              ELSE (v_scores #>> ARRAY[v_ci::text, v_oppman::text, v_ri::text])::INT
            END;
          END IF;

          IF v_own IS NULL OR v_opp IS NULL THEN
            CONTINUE;
          END IF;

          v_dif := v_own - v_opp;
          v_diff  := v_diff + v_dif;
          v_pts   := v_pts + thai32_diff_to_pts(v_dif);
          v_balls := v_balls + v_own;
          IF v_dif > 0 THEN
            v_wins := v_wins + 1;
          END IF;
        END LOOP;

        INSERT INTO tmp_thai32_totals(gender, name, wins, diff, pts, balls)
        VALUES (v_gender, v_name, v_wins, v_diff, v_pts, v_balls)
        ON CONFLICT (gender, name) DO UPDATE SET
          wins  = tmp_thai32_totals.wins  + EXCLUDED.wins,
          diff  = tmp_thai32_totals.diff  + EXCLUDED.diff,
          pts   = tmp_thai32_totals.pts   + EXCLUDED.pts,
          balls = tmp_thai32_totals.balls + EXCLUDED.balls;
      END LOOP;
    END LOOP;
  END LOOP;

  -- R2: divScores + divRoster within zones
  FOREACH v_div_key IN ARRAY ARRAY['hard','advance','medium','lite'] LOOP
    v_nd := COALESCE(jsonb_array_length(v_div_roster #> ARRAY[v_div_key, 'men']), 0);
    IF v_nd < 1 THEN
      CONTINUE;
    END IF;

    -- Men
    FOR v_mi IN 0..(v_nd-1) LOOP
      v_name := (v_div_roster #>> ARRAY[v_div_key, 'men', v_mi::text]);
      IF v_name IS NULL OR trim(v_name) = '' THEN CONTINUE; END IF;

      v_wins  := 0;
      v_diff  := 0;
      v_pts   := 0;
      v_balls := 0;

      FOR v_ri IN 0..3 LOOP
        v_own := (v_div_scores #>> ARRAY[v_div_key, v_mi::text, v_ri::text])::INT;
        v_oppmi := thai32_ipt_opp_idx(v_mi, v_ri);
        v_opp := CASE
          WHEN v_oppmi IS NULL THEN NULL
          ELSE (v_div_scores #>> ARRAY[v_div_key, v_oppmi::text, v_ri::text])::INT
        END;
        IF v_own IS NULL OR v_opp IS NULL THEN
          CONTINUE;
        END IF;
        v_dif := v_own - v_opp;
        v_diff  := v_diff + v_dif;
        v_pts   := v_pts + thai32_diff_to_pts(v_dif);
        v_balls := v_balls + v_own;
        IF v_dif > 0 THEN v_wins := v_wins + 1; END IF;
      END LOOP;

      INSERT INTO tmp_thai32_totals(gender, name, wins, diff, pts, balls)
      VALUES ('M', v_name, v_wins, v_diff, v_pts, v_balls)
      ON CONFLICT (gender, name) DO UPDATE SET
        wins  = tmp_thai32_totals.wins  + EXCLUDED.wins,
        diff  = tmp_thai32_totals.diff  + EXCLUDED.diff,
        pts   = tmp_thai32_totals.pts   + EXCLUDED.pts,
        balls = tmp_thai32_totals.balls + EXCLUDED.balls;
    END LOOP;

    -- Women
    FOR v_wi IN 0..(v_nd-1) LOOP
      v_name := (v_div_roster #>> ARRAY[v_div_key, 'women', v_wi::text]);
      IF v_name IS NULL OR trim(v_name) = '' THEN CONTINUE; END IF;

      v_wins  := 0;
      v_diff  := 0;
      v_pts   := 0;
      v_balls := 0;

      FOR v_ri IN 0..3 LOOP
        v_manidx := thai32_div_partner_m(v_wi, v_ri, v_nd);
        v_own := (v_div_scores #>> ARRAY[v_div_key, v_manidx::text, v_ri::text])::INT;
        v_oppman := thai32_ipt_opp_idx(v_manidx, v_ri);
        v_opp := CASE
          WHEN v_oppman IS NULL THEN NULL
          ELSE (v_div_scores #>> ARRAY[v_div_key, v_oppman::text, v_ri::text])::INT
        END;
        IF v_own IS NULL OR v_opp IS NULL THEN
          CONTINUE;
        END IF;
        v_dif := v_own - v_opp;
        v_diff  := v_diff + v_dif;
        v_pts   := v_pts + thai32_diff_to_pts(v_dif);
        v_balls := v_balls + v_own;
        IF v_dif > 0 THEN v_wins := v_wins + 1; END IF;
      END LOOP;

      INSERT INTO tmp_thai32_totals(gender, name, wins, diff, pts, balls)
      VALUES ('W', v_name, v_wins, v_diff, v_pts, v_balls)
      ON CONFLICT (gender, name) DO UPDATE SET
        wins  = tmp_thai32_totals.wins  + EXCLUDED.wins,
        diff  = tmp_thai32_totals.diff  + EXCLUDED.diff,
        pts   = tmp_thai32_totals.pts   + EXCLUDED.pts,
        balls = tmp_thai32_totals.balls + EXCLUDED.balls;
    END LOOP;
  END LOOP;

  -- Ranking by combined totals (same priority as client finishTournament):
  -- wins → diff → pts → coef → balls
  CREATE TEMP TABLE tmp_thai32_order AS
  SELECT
    s.gender,
    s.name,
    s.wins,
    s.diff,
    s.pts,
    s.balls,
    s.coef,
    s.place,
    thai32_rating_pts(s.place) AS rating_pts,
    s.pts AS game_pts
  FROM (
    SELECT
      t.*,
      thai32_calc_k(t.diff) AS coef,
      ROW_NUMBER() OVER (
        ORDER BY
          t.wins  DESC,
          t.diff  DESC,
          t.pts   DESC,
          thai32_calc_k(t.diff) DESC,
          t.balls DESC,
          t.name ASC
      ) AS place
    FROM tmp_thai32_totals t
  ) s;

  -- ③ Upsert player profiles + tournament_results (override place/points/coef by server)
  FOR v_rec IN
    SELECT *
    FROM jsonb_to_recordset(p_results) AS x(
      name              TEXT,
      gender            TEXT,
      place             INT,
      game_pts          INT,
      rating_pts        INT,
      rating_type       TEXT,
      rating_m          INT,
      rating_w          INT,
      rating_mix        INT,
      tournaments_m     INT,
      tournaments_w     INT,
      tournaments_mix   INT,
      wins              INT,
      last_seen         TEXT,
      total_pts         INT,
      tournaments_played INT
    )
  LOOP
    -- Upsert player (use client-provided accumulated rating totals for idempotency)
    INSERT INTO players (
      name, gender, status,
      rating_m, rating_w, rating_mix,
      tournaments_m, tournaments_w, tournaments_mix,
      wins, last_seen, tournaments_played, total_pts
    )
    VALUES (
      trim(v_rec.name), v_rec.gender, 'active',
      COALESCE(v_rec.rating_m,  0),
      COALESCE(v_rec.rating_w,  0),
      COALESCE(v_rec.rating_mix,0),
      COALESCE(v_rec.tournaments_m,   0),
      COALESCE(v_rec.tournaments_w,   0),
      COALESCE(v_rec.tournaments_mix, 0),
      COALESCE(v_rec.wins, 0),
      CASE WHEN v_rec.last_seen IS NOT NULL AND v_rec.last_seen <> ''
           THEN v_rec.last_seen::DATE ELSE NULL END,
      COALESCE(v_rec.tournaments_played, 0),
      COALESCE(v_rec.total_pts, 0)
    )
    ON CONFLICT (lower(trim(name)), gender) DO UPDATE SET
      status            = 'active',
      rating_m          = EXCLUDED.rating_m,
      rating_w          = EXCLUDED.rating_w,
      rating_mix        = EXCLUDED.rating_mix,
      tournaments_m     = EXCLUDED.tournaments_m,
      tournaments_w     = EXCLUDED.tournaments_w,
      tournaments_mix   = EXCLUDED.tournaments_mix,
      wins              = EXCLUDED.wins,
      last_seen         = CASE
                            WHEN EXCLUDED.last_seen IS NOT NULL
                            THEN GREATEST(players.last_seen, EXCLUDED.last_seen)
                            ELSE players.last_seen
                          END,
      tournaments_played = EXCLUDED.tournaments_played,
      total_pts         = EXCLUDED.total_pts
    RETURNING * INTO v_player;

    IF v_player.id IS NULL THEN
      SELECT * INTO v_player
        FROM players
       WHERE lower(trim(name)) = lower(trim(v_rec.name))
         AND gender = v_rec.gender
       LIMIT 1;
    END IF;

    IF v_player.id IS NULL THEN
      CONTINUE;
    END IF;

    -- Server computed values
    v_place      := NULL;
    v_game_pts   := NULL;
    v_rating_pts := NULL;
    v_wins_out   := NULL;
    v_diff_out   := NULL;
    v_coef_out   := NULL;
    v_balls_out  := NULL;

    SELECT
      o.place,
      o.game_pts,
      o.rating_pts,
      o.wins,
      o.diff,
      o.coef,
      o.balls
    INTO
      v_place,
      v_game_pts,
      v_rating_pts,
      v_wins_out,
      v_diff_out,
      v_coef_out,
      v_balls_out
    FROM tmp_thai32_order o
    WHERE lower(trim(o.name)) = lower(trim(v_rec.name))
      AND o.gender = v_rec.gender
    LIMIT 1;

    IF v_place IS NULL THEN
      -- Fallback to client values
      v_place      := COALESCE(v_rec.place, 1);
      v_game_pts   := COALESCE(v_rec.game_pts, 0);
      v_rating_pts := COALESCE(v_rec.rating_pts, 0);
      v_wins_out   := COALESCE(v_rec.wins, 0);
      v_diff_out   := 0;
      v_coef_out   := 0;
      v_balls_out  := 0;
    END IF;

    INSERT INTO tournament_results
      (tournament_id, player_id, place, game_pts, rating_pts, gender, rating_type,
       wins, diff, coef, balls)
    VALUES
      (v_trn_id, v_player.id, v_place, v_game_pts, v_rating_pts,
       v_rec.gender, COALESCE(NULLIF(v_rec.rating_type, ''), 'M'),
       v_wins_out, v_diff_out, v_coef_out, v_balls_out)
    ON CONFLICT (tournament_id, player_id) DO UPDATE SET
      place      = EXCLUDED.place,
      game_pts   = EXCLUDED.game_pts,
      rating_pts = EXCLUDED.rating_pts,
      wins       = EXCLUDED.wins,
      diff       = EXCLUDED.diff,
      coef       = EXCLUDED.coef,
      balls      = EXCLUDED.balls;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', v_trn_id,
    'results_saved', v_count
  );
END;
$$;


ALTER FUNCTION public.publish_tournament_results_thai32_server_compute(p_external_id text, p_name text, p_date text, p_format text, p_division text, p_results jsonb, p_raw_results jsonb) OWNER TO postgres;

--
-- Name: push_room_state(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.push_room_state(p_room_code text, p_room_secret text, p_state jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code   TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret TEXT := trim(coalesce(p_room_secret, ''));
  v_row    kotc_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;

  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный секрет комнаты');
  END IF;

  UPDATE kotc_sessions
     SET state = coalesce(p_state, '{}'::jsonb),
         updated_at = now()
   WHERE room_code = v_code
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', v_row.updated_at,
    'message', 'Состояние комнаты сохранено'
  );
END;
$$;


ALTER FUNCTION public.push_room_state(p_room_code text, p_room_secret text, p_state jsonb) OWNER TO postgres;

--
-- Name: reject_player_request(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reject_player_request(p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_row player_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM player_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'request_not_found');
  END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'already_processed');
  END IF;
  UPDATE player_requests
     SET status = 'rejected', reviewed_at = now()
   WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true, 'message', 'rejected');
END;
$$;


ALTER FUNCTION public.reject_player_request(p_request_id uuid) OWNER TO postgres;

--
-- Name: room_secret_sha256(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.room_secret_sha256(p_secret text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex')
$$;


ALTER FUNCTION public.room_secret_sha256(p_secret text) OWNER TO postgres;

--
-- Name: rotate_room_secret(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rotate_room_secret(p_room_code text, p_room_secret text, p_new_room_secret text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code       TEXT := upper(trim(coalesce(p_room_code, '')));
  v_secret     TEXT := trim(coalesce(p_room_secret, ''));
  v_new_secret TEXT := trim(coalesce(p_new_room_secret, ''));
  v_row        kotc_sessions%ROWTYPE;
BEGIN
  IF length(v_new_secret) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_SHORT', 'message', 'Новый секрет должен быть не короче 6 символов');
  END IF;

  SELECT * INTO v_row
    FROM kotc_sessions
   WHERE room_code = v_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND', 'message', 'Комната не найдена');
  END IF;

  IF v_row.room_secret_hash <> room_secret_sha256(v_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_SECRET_MISMATCH', 'message', 'Неверный текущий секрет');
  END IF;

  UPDATE kotc_sessions
     SET room_secret_hash = room_secret_sha256(v_new_secret),
         updated_at = now()
   WHERE room_code = v_code
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_at', v_row.updated_at,
    'message', 'Секрет комнаты обновлён'
  );
END;
$$;


ALTER FUNCTION public.rotate_room_secret(p_room_code text, p_room_secret text, p_new_room_secret text) OWNER TO postgres;

--
-- Name: safe_cancel_registration(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.safe_cancel_registration(p_tournament_id uuid, p_player_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_trn          tournaments%ROWTYPE;
  v_was_waitlist BOOLEAN;
  v_promoted_id  UUID;
  v_promoted_nm  TEXT;
  v_current      INT;
BEGIN
  -- ① Блокируем турнир
  SELECT * INTO v_trn
    FROM tournaments
   WHERE id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_NOT_FOUND',
      'message', 'Турнир не найден');
  END IF;

  -- ② Участник зарегистрирован?
  SELECT is_waitlist INTO v_was_waitlist
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND player_id     = p_player_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'NOT_REGISTERED',
      'message', 'Игрок не найден в списке участников');
  END IF;

  -- ③ Удаляем
  DELETE FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND player_id     = p_player_id;

  -- ④ Если был в основном составе — откатываем статистику
  IF NOT v_was_waitlist THEN
    UPDATE players
       SET tournaments_played = GREATEST(tournaments_played - 1, 0)
     WHERE id = p_player_id;
  END IF;

  -- ⑤ Если был в основном составе и есть waitlist → продвигаем
  v_promoted_id := NULL;
  IF NOT v_was_waitlist THEN
    -- Берём первого из waitlist (минимальная позиция)
    SELECT tp.player_id INTO v_promoted_id
      FROM tournament_participants tp
     WHERE tp.tournament_id = p_tournament_id
       AND tp.is_waitlist = true
     ORDER BY tp.position ASC
     LIMIT 1
       FOR UPDATE SKIP LOCKED;  -- предотвращаем гонку

    IF v_promoted_id IS NOT NULL THEN
      -- Переводим в основной состав
      UPDATE tournament_participants
         SET is_waitlist = false,
             position = (
               SELECT COALESCE(MAX(position), 0) + 1
                 FROM tournament_participants
                WHERE tournament_id = p_tournament_id
                  AND is_waitlist = false
             )
       WHERE tournament_id = p_tournament_id
         AND player_id = v_promoted_id;

      -- Статистика для продвинутого
      UPDATE players
         SET tournaments_played = tournaments_played + 1
       WHERE id = v_promoted_id;

      SELECT name INTO v_promoted_nm FROM players WHERE id = v_promoted_id;
    END IF;
  END IF;

  -- ⑥ Пересчёт статуса турнира
  SELECT COUNT(*) INTO v_current
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = false;

  IF v_current < v_trn.capacity AND v_trn.status = 'full' THEN
    UPDATE tournaments SET status = 'open' WHERE id = p_tournament_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'promoted', v_promoted_id IS NOT NULL,
    'promoted_player', COALESCE(v_promoted_nm, ''),
    'current',  v_current,
    'capacity', v_trn.capacity,
    'message',  'Регистрация отменена'
      || CASE WHEN v_promoted_nm IS NOT NULL
           THEN '. ' || v_promoted_nm || ' переведён(а) из листа ожидания'
           ELSE '' END
  );
END;
$$;


ALTER FUNCTION public.safe_cancel_registration(p_tournament_id uuid, p_player_id uuid) OWNER TO postgres;

--
-- Name: safe_register_player(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.safe_register_player(p_tournament_id uuid, p_player_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_trn          tournaments%ROWTYPE;
  v_current      INT;
  v_gender_count INT;
  v_max_gender   INT;
  v_is_waitlist  BOOLEAN;
  v_position     INT;
  v_player       players%ROWTYPE;
BEGIN
  -- ① Блокируем строку турнира
  SELECT * INTO v_trn
    FROM tournaments
   WHERE id = p_tournament_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_NOT_FOUND',
      'message', 'Турнир не найден');
  END IF;

  -- ② Турнир закрыт?
  IF v_trn.status IN ('finished', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'TOURNAMENT_CLOSED',
      'message', 'Турнир завершён или отменён');
  END IF;

  -- ③ Игрок существует?
  SELECT * INTO v_player FROM players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'PLAYER_NOT_FOUND',
      'message', 'Игрок не найден в базе');
  END IF;

  -- ④ Уже зарегистрирован?
  IF EXISTS (
    SELECT 1 FROM tournament_participants
     WHERE tournament_id = p_tournament_id
       AND player_id     = p_player_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'ALREADY_REGISTERED',
      'message', v_player.name || ' уже зарегистрирован(а)');
  END IF;

  -- ⑤ Считаем текущих (не waitlist)
  SELECT COUNT(*) INTO v_current
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = false;

  -- ⑥ Gender constraint check
  -- min_female резервирует места для Ж, ограничивая М (и наоборот)
  IF COALESCE(v_trn.min_male, 0) > 0 OR COALESCE(v_trn.min_female, 0) > 0 THEN
    SELECT COUNT(*) INTO v_gender_count
      FROM tournament_participants tp
      JOIN players pl ON pl.id = tp.player_id
     WHERE tp.tournament_id = p_tournament_id
       AND tp.is_waitlist = false
       AND pl.gender = v_player.gender;

    -- max для данного пола = capacity - min_противоположного
    IF v_player.gender = 'M' THEN
      v_max_gender := v_trn.capacity - COALESCE(v_trn.min_female, 0);
    ELSE
      v_max_gender := v_trn.capacity - COALESCE(v_trn.min_male, 0);
    END IF;

    IF v_max_gender > 0 AND v_gender_count >= v_max_gender THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'GENDER_LIMIT',
        'message', 'Лимит ' || CASE v_player.gender WHEN 'M' THEN 'мужчин' ELSE 'женщин' END
          || ' исчерпан (' || v_gender_count || '/' || v_max_gender || ').'
          || ' Места зарезервированы для '
          || CASE v_player.gender WHEN 'M' THEN 'женщин' ELSE 'мужчин' END || '.');
    END IF;
  END IF;

  -- ⑦ Место есть или waitlist?
  v_is_waitlist := v_current >= v_trn.capacity;

  -- ⑧ Позиция
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
    FROM tournament_participants
   WHERE tournament_id = p_tournament_id
     AND is_waitlist = v_is_waitlist;

  -- ⑨ Вставляем
  INSERT INTO tournament_participants
    (tournament_id, player_id, is_waitlist, position)
  VALUES
    (p_tournament_id, p_player_id, v_is_waitlist, v_position);

  -- ⑩ Обновляем статус
  IF NOT v_is_waitlist AND (v_current + 1) >= v_trn.capacity THEN
    UPDATE tournaments SET status = 'full' WHERE id = p_tournament_id;
  END IF;

  -- ⑪ Статистика
  IF NOT v_is_waitlist THEN
    UPDATE players SET tournaments_played = tournaments_played + 1
     WHERE id = p_player_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'waitlist',  v_is_waitlist,
    'position',  v_position,
    'total',     v_current + CASE WHEN v_is_waitlist THEN 0 ELSE 1 END,
    'capacity',  v_trn.capacity,
    'player',    v_player.name,
    'message',   CASE
      WHEN v_is_waitlist THEN v_player.name || ' → лист ожидания (#' || v_position || ')'
      ELSE v_player.name || ' зарегистрирован(а) (' || (v_current+1) || '/' || v_trn.capacity || ')'
    END
  );
END;
$$;


ALTER FUNCTION public.safe_register_player(p_tournament_id uuid, p_player_id uuid) OWNER TO postgres;

--
-- Name: search_players(text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.search_players(p_query text, p_gender text DEFAULT NULL::text, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, gender text, status text, tournaments_played integer, total_pts integer, similarity real)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
    SELECT
      p.id, p.name, p.gender, p.status,
      p.tournaments_played, p.total_pts,
      similarity(p.name, p_query) AS similarity
    FROM players p
    WHERE
      (p_gender IS NULL OR p.gender = p_gender)
      AND (
        p.name ILIKE '%' || p_query || '%'
        OR similarity(p.name, p_query) > 0.2
      )
    ORDER BY
      -- Точное начало имени → первым
      (p.name ILIKE p_query || '%') DESC,
      similarity(p.name, p_query) DESC,
      p.tournaments_played DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION public.search_players(p_query text, p_gender text, p_limit integer) OWNER TO postgres;

--
-- Name: submit_player_request(text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.submit_player_request(p_name text, p_gender text, p_phone text DEFAULT NULL::text, p_tournament_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_req player_requests%ROWTYPE;
BEGIN
  p_name := trim(coalesce(p_name, ''));
  IF p_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED', 'message', 'Укажите имя игрока');
  END IF;

  IF p_gender NOT IN ('M', 'W') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_GENDER', 'message', 'Пол должен быть M или W');
  END IF;

  SELECT * INTO v_req
    FROM player_requests
   WHERE lower(trim(name)) = lower(p_name)
     AND gender = p_gender
     AND status = 'pending'
     AND (
       (tournament_id IS NULL AND p_tournament_id IS NULL)
       OR tournament_id = p_tournament_id
     )
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'request_id', v_req.id,
      'message', p_name || ' уже ожидает проверки'
    );
  END IF;

  INSERT INTO player_requests (name, gender, phone, tournament_id, status)
  VALUES (p_name, p_gender, NULLIF(trim(coalesce(p_phone, '')), ''), p_tournament_id, 'pending')
  RETURNING * INTO v_req;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_req.id,
    'message', p_name || ' добавлен(а) в очередь на проверку'
  );
END;
$$;


ALTER FUNCTION public.submit_player_request(p_name text, p_gender text, p_phone text, p_tournament_id uuid) OWNER TO postgres;

--
-- Name: thai32_calc_k(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_calc_k(p_diff_sum integer) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  denom NUMERIC := 60 - p_diff_sum;
BEGIN
  IF abs(denom) < 1e-9 THEN
    RETURN 999.99;
  END IF;
  RETURN (60 + p_diff_sum) / denom;
END;
$$;


ALTER FUNCTION public.thai32_calc_k(p_diff_sum integer) OWNER TO postgres;

--
-- Name: thai32_diff_to_pts(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_diff_to_pts(p_diff integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_diff >= 7 THEN 3
    WHEN p_diff >= 3 THEN 2
    WHEN p_diff >= 1 THEN 1
    ELSE 0
  END;
$$;


ALTER FUNCTION public.thai32_diff_to_pts(p_diff integer) OWNER TO postgres;

--
-- Name: thai32_div_partner_m(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_div_partner_m(p_wi integer, p_ri integer, p_nd integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (((p_wi - p_ri) % p_nd + p_nd) % p_nd);
$$;


ALTER FUNCTION public.thai32_div_partner_m(p_wi integer, p_ri integer, p_nd integer) OWNER TO postgres;

--
-- Name: thai32_ipt_opp_idx(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_ipt_opp_idx(p_mi integer, p_ri integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    -- ri=0: (0↔1), (2↔3)
    WHEN p_ri = 0 AND p_mi = 0 THEN 1
    WHEN p_ri = 0 AND p_mi = 1 THEN 0
    WHEN p_ri = 0 AND p_mi = 2 THEN 3
    WHEN p_ri = 0 AND p_mi = 3 THEN 2

    -- ri=1: (0↔2), (1↔3)
    WHEN p_ri = 1 AND p_mi = 0 THEN 2
    WHEN p_ri = 1 AND p_mi = 2 THEN 0
    WHEN p_ri = 1 AND p_mi = 1 THEN 3
    WHEN p_ri = 1 AND p_mi = 3 THEN 1

    -- ri=2: (0↔3), (1↔2)
    WHEN p_ri = 2 AND p_mi = 0 THEN 3
    WHEN p_ri = 2 AND p_mi = 3 THEN 0
    WHEN p_ri = 2 AND p_mi = 1 THEN 2
    WHEN p_ri = 2 AND p_mi = 2 THEN 1

    -- ri=3 (same as ri=2): (0↔3), (1↔2)
    WHEN p_ri = 3 AND p_mi = 0 THEN 3
    WHEN p_ri = 3 AND p_mi = 3 THEN 0
    WHEN p_ri = 3 AND p_mi = 1 THEN 2
    WHEN p_ri = 3 AND p_mi = 2 THEN 1
    ELSE NULL
  END;
$$;


ALTER FUNCTION public.thai32_ipt_opp_idx(p_mi integer, p_ri integer) OWNER TO postgres;

--
-- Name: thai32_partner_m(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_partner_m(p_wi integer, p_ri integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT (((p_wi - p_ri) % 4 + 4) % 4);
$$;


ALTER FUNCTION public.thai32_partner_m(p_wi integer, p_ri integer) OWNER TO postgres;

--
-- Name: thai32_rating_pts(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.thai32_rating_pts(p_place integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_place
    WHEN  1 THEN 100
    WHEN  2 THEN  90
    WHEN  3 THEN  82
    WHEN  4 THEN  76
    WHEN  5 THEN  70
    WHEN  6 THEN  65
    WHEN  7 THEN  60
    WHEN  8 THEN  56
    WHEN  9 THEN  52
    WHEN 10 THEN  48
    WHEN 11 THEN  44
    WHEN 12 THEN  42
    WHEN 13 THEN  40
    WHEN 14 THEN  38
    WHEN 15 THEN  36
    WHEN 16 THEN  34
    WHEN 17 THEN  32
    WHEN 18 THEN  30
    WHEN 19 THEN  28
    WHEN 20 THEN  26
    WHEN 21 THEN  24
    WHEN 22 THEN  22
    WHEN 23 THEN  20
    WHEN 24 THEN  18
    WHEN 25 THEN  16
    WHEN 26 THEN  14
    WHEN 27 THEN  12
    WHEN 28 THEN  10
    WHEN 29 THEN   8
    WHEN 30 THEN   7
    WHEN 31 THEN   6
    WHEN 32 THEN   5
    WHEN 33 THEN   4
    WHEN 34 THEN   3
    WHEN 35 THEN   2
    WHEN 36 THEN   2
    WHEN 37 THEN   1
    WHEN 38 THEN   1
    WHEN 39 THEN   1
    WHEN 40 THEN   1
    ELSE 1
  END;
$$;


ALTER FUNCTION public.thai32_rating_pts(p_place integer) OWNER TO postgres;

--
-- Name: trg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION public.trg_set_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: kotc_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kotc_sessions (
    room_code text NOT NULL,
    room_secret_hash text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.kotc_sessions OWNER TO postgres;

--
-- Name: merge_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.merge_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    temp_player_id uuid NOT NULL,
    real_player_id uuid NOT NULL,
    temp_name text NOT NULL,
    real_name text NOT NULL,
    records_moved integer DEFAULT 0,
    merged_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.merge_audit OWNER TO postgres;

--
-- Name: player_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.player_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    gender text NOT NULL,
    phone text,
    tournament_id uuid,
    status text DEFAULT 'pending'::text,
    approved_player_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    CONSTRAINT player_requests_gender_check CHECK ((gender = ANY (ARRAY['M'::text, 'W'::text]))),
    CONSTRAINT player_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


ALTER TABLE public.player_requests OWNER TO postgres;

--
-- Name: players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.players (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    gender text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    phone text,
    tournaments_played integer DEFAULT 0,
    total_pts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rating_m integer DEFAULT 0,
    rating_w integer DEFAULT 0,
    rating_mix integer DEFAULT 0,
    tournaments_m integer DEFAULT 0,
    tournaments_w integer DEFAULT 0,
    tournaments_mix integer DEFAULT 0,
    wins integer DEFAULT 0,
    last_seen date,
    local_id text,
    synced_at timestamp with time zone DEFAULT now(),
    CONSTRAINT players_gender_check CHECK ((gender = ANY (ARRAY['M'::text, 'W'::text]))),
    CONSTRAINT players_status_check CHECK ((status = ANY (ARRAY['active'::text, 'temporary'::text])))
);


ALTER TABLE public.players OWNER TO postgres;

--
-- Name: tournament_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tournament_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    player_id uuid NOT NULL,
    is_waitlist boolean DEFAULT false,
    "position" integer DEFAULT 0 NOT NULL,
    registered_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.tournament_participants OWNER TO postgres;

--
-- Name: tournament_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tournament_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tournament_id uuid NOT NULL,
    player_id uuid NOT NULL,
    place integer NOT NULL,
    game_pts integer DEFAULT 0,
    rating_pts integer DEFAULT 0,
    gender text,
    rating_type text,
    created_at timestamp with time zone DEFAULT now(),
    wins integer DEFAULT 0,
    diff integer DEFAULT 0,
    coef numeric DEFAULT 0,
    balls integer DEFAULT 0,
    CONSTRAINT tournament_results_gender_check CHECK ((gender = ANY (ARRAY['M'::text, 'W'::text]))),
    CONSTRAINT tournament_results_rating_type_check CHECK ((rating_type = ANY (ARRAY['M'::text, 'W'::text, 'Mix'::text])))
);


ALTER TABLE public.tournament_results OWNER TO postgres;

--
-- Name: tournaments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tournaments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    date date,
    "time" time without time zone,
    location text,
    format text DEFAULT 'King of the Court'::text,
    division text,
    level text DEFAULT 'medium'::text,
    capacity integer DEFAULT 24 NOT NULL,
    prize text,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    min_male integer DEFAULT 0,
    min_female integer DEFAULT 0,
    external_id text,
    game_state jsonb DEFAULT '{}'::jsonb,
    synced_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tournaments_capacity_check CHECK ((capacity >= 4)),
    CONSTRAINT tournaments_division_check CHECK ((division = ANY (ARRAY['Мужской'::text, 'Женский'::text, 'Микст'::text]))),
    CONSTRAINT tournaments_level_check CHECK ((level = ANY (ARRAY['hard'::text, 'medium'::text, 'easy'::text]))),
    CONSTRAINT tournaments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'full'::text, 'finished'::text, 'cancelled'::text])))
);


ALTER TABLE public.tournaments OWNER TO postgres;

--
-- Name: COLUMN tournaments.min_male; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tournaments.min_male IS 'Мин. мужчин для начала турнира. 0 = без ограничений.';


--
-- Name: COLUMN tournaments.min_female; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tournaments.min_female IS 'Мин. женщин для начала турнира. 0 = без ограничений.';


--
-- Data for Name: kotc_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kotc_sessions (room_code, room_secret_hash, state, created_at, updated_at) FROM stdin;
СУДЬИ	b256cbf46e1aac221f5f4b6d91ec3cea9b657c86b9d6801be7ab1a9e5bc67212	{"score": 21}	2026-03-19 12:18:57.966414+00	2026-03-19 12:21:08.586972+00
\.


--
-- Data for Name: merge_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.merge_audit (id, temp_player_id, real_player_id, temp_name, real_name, records_moved, merged_at) FROM stdin;
\.


--
-- Data for Name: player_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.player_requests (id, name, gender, phone, tournament_id, status, approved_player_id, created_at, reviewed_at) FROM stdin;
\.


--
-- Data for Name: players; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.players (id, name, gender, status, phone, tournaments_played, total_pts, created_at, updated_at, rating_m, rating_w, rating_mix, tournaments_m, tournaments_w, tournaments_mix, wins, last_seen, local_id, synced_at) FROM stdin;
\.


--
-- Data for Name: tournament_participants; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tournament_participants (id, tournament_id, player_id, is_waitlist, "position", registered_at) FROM stdin;
\.


--
-- Data for Name: tournament_results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tournament_results (id, tournament_id, player_id, place, game_pts, rating_pts, gender, rating_type, created_at, wins, diff, coef, balls) FROM stdin;
\.


--
-- Data for Name: tournaments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tournaments (id, name, date, "time", location, format, division, level, capacity, prize, status, created_at, min_male, min_female, external_id, game_state, synced_at) FROM stdin;
15fd75c8-3f0c-4973-9c9e-d9134aa6a60d	Тест синк	\N	\N	\N	IPT Mixed	\N	medium	24	\N	open	2026-03-19 12:13:20.577554+00	0	0	test_sync_01	{"id": "test_sync_01", "name": "Тест синк"}	2026-03-19 12:13:20.577554+00
\.


--
-- Name: kotc_sessions kotc_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kotc_sessions
    ADD CONSTRAINT kotc_sessions_pkey PRIMARY KEY (room_code);


--
-- Name: merge_audit merge_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.merge_audit
    ADD CONSTRAINT merge_audit_pkey PRIMARY KEY (id);


--
-- Name: player_requests player_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_requests
    ADD CONSTRAINT player_requests_pkey PRIMARY KEY (id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: tournament_participants tournament_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_participants
    ADD CONSTRAINT tournament_participants_pkey PRIMARY KEY (id);


--
-- Name: tournament_participants tournament_participants_tournament_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_participants
    ADD CONSTRAINT tournament_participants_tournament_id_player_id_key UNIQUE (tournament_id, player_id);


--
-- Name: tournament_results tournament_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_pkey PRIMARY KEY (id);


--
-- Name: tournament_results tournament_results_tournament_id_player_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_tournament_id_player_id_key UNIQUE (tournament_id, player_id);


--
-- Name: tournaments tournaments_external_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_external_id_unique UNIQUE (external_id);


--
-- Name: tournaments tournaments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournaments
    ADD CONSTRAINT tournaments_pkey PRIMARY KEY (id);


--
-- Name: idx_kotc_sessions_updated_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_kotc_sessions_updated_at ON public.kotc_sessions USING btree (updated_at DESC);


--
-- Name: idx_players_local_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_players_local_id ON public.players USING btree (local_id);


--
-- Name: idx_players_name_gender; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_players_name_gender ON public.players USING btree (lower(TRIM(BOTH FROM name)), gender);


--
-- Name: idx_players_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_players_name_trgm ON public.players USING gin (name public.gin_trgm_ops);


--
-- Name: idx_players_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_players_status ON public.players USING btree (status);


--
-- Name: idx_pr_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pr_status ON public.player_requests USING btree (status);


--
-- Name: idx_tournaments_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tournaments_date ON public.tournaments USING btree (date DESC);


--
-- Name: idx_tournaments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tournaments_status ON public.tournaments USING btree (status);


--
-- Name: idx_tp_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tp_player ON public.tournament_participants USING btree (player_id);


--
-- Name: idx_tp_tournament; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tp_tournament ON public.tournament_participants USING btree (tournament_id, is_waitlist);


--
-- Name: idx_tr_place; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tr_place ON public.tournament_results USING btree (tournament_id, place);


--
-- Name: idx_tr_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tr_player ON public.tournament_results USING btree (player_id);


--
-- Name: idx_tr_tournament; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tr_tournament ON public.tournament_results USING btree (tournament_id);


--
-- Name: players players_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();


--
-- Name: player_requests player_requests_approved_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_requests
    ADD CONSTRAINT player_requests_approved_player_id_fkey FOREIGN KEY (approved_player_id) REFERENCES public.players(id) ON DELETE SET NULL;


--
-- Name: player_requests player_requests_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_requests
    ADD CONSTRAINT player_requests_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE SET NULL;


--
-- Name: tournament_participants tournament_participants_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_participants
    ADD CONSTRAINT tournament_participants_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: tournament_participants tournament_participants_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_participants
    ADD CONSTRAINT tournament_participants_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: tournament_results tournament_results_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id) ON DELETE CASCADE;


--
-- Name: tournament_results tournament_results_tournament_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tournament_results
    ADD CONSTRAINT tournament_results_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;


--
-- Name: kotc_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.kotc_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: merge_audit ma_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ma_select ON public.merge_audit FOR SELECT USING (true);


--
-- Name: merge_audit; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.merge_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: player_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.player_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: players; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

--
-- Name: players players_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY players_insert ON public.players FOR INSERT TO anon WITH CHECK (true);


--
-- Name: players players_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY players_select ON public.players FOR SELECT USING (true);


--
-- Name: players players_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY players_update ON public.players FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: player_requests pr_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY pr_select ON public.player_requests FOR SELECT USING (true);


--
-- Name: tournament_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: tournament_results; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tournament_results ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

--
-- Name: tournaments tournaments_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tournaments_insert ON public.tournaments FOR INSERT TO anon WITH CHECK (true);


--
-- Name: tournaments tournaments_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tournaments_select ON public.tournaments FOR SELECT TO anon USING (true);


--
-- Name: tournaments tournaments_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tournaments_update ON public.tournaments FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: tournament_participants tp_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tp_select ON public.tournament_participants FOR SELECT USING (true);


--
-- Name: tournament_results tr_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tr_select ON public.tournament_results FOR SELECT USING (true);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;


--
-- Name: FUNCTION approve_player_request(p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.approve_player_request(p_request_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION create_room(p_room_code text, p_room_secret text, p_initial_state jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_room(p_room_code text, p_room_secret text, p_initial_state jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_room(p_room_code text, p_room_secret text, p_initial_state jsonb) TO anon;


--
-- Name: FUNCTION create_temporary_player(p_name text, p_gender text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_temporary_player(p_name text, p_gender text) FROM PUBLIC;


--
-- Name: FUNCTION get_room_state(p_room_code text, p_room_secret text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_room_state(p_room_code text, p_room_secret text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_room_state(p_room_code text, p_room_secret text) TO anon;


--
-- Name: FUNCTION list_pending_requests(p_tournament_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.list_pending_requests(p_tournament_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION merge_players(p_temp_id uuid, p_real_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.merge_players(p_temp_id uuid, p_real_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION push_room_state(p_room_code text, p_room_secret text, p_state jsonb); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.push_room_state(p_room_code text, p_room_secret text, p_state jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.push_room_state(p_room_code text, p_room_secret text, p_state jsonb) TO anon;


--
-- Name: FUNCTION reject_player_request(p_request_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.reject_player_request(p_request_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION room_secret_sha256(p_secret text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.room_secret_sha256(p_secret text) FROM PUBLIC;


--
-- Name: FUNCTION rotate_room_secret(p_room_code text, p_room_secret text, p_new_room_secret text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.rotate_room_secret(p_room_code text, p_room_secret text, p_new_room_secret text) FROM PUBLIC;


--
-- Name: FUNCTION safe_cancel_registration(p_tournament_id uuid, p_player_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.safe_cancel_registration(p_tournament_id uuid, p_player_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION safe_register_player(p_tournament_id uuid, p_player_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.safe_register_player(p_tournament_id uuid, p_player_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION search_players(p_query text, p_gender text, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.search_players(p_query text, p_gender text, p_limit integer) FROM PUBLIC;


--
-- Name: FUNCTION submit_player_request(p_name text, p_gender text, p_phone text, p_tournament_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.submit_player_request(p_name text, p_gender text, p_phone text, p_tournament_id uuid) FROM PUBLIC;


--
-- Name: TABLE kotc_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kotc_sessions TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kotc_sessions TO authenticated;


--
-- Name: TABLE merge_audit; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merge_audit TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.merge_audit TO authenticated;


--
-- Name: TABLE player_requests; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.player_requests TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.player_requests TO authenticated;


--
-- Name: TABLE players; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.players TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.players TO authenticated;


--
-- Name: TABLE tournament_participants; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournament_participants TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournament_participants TO authenticated;


--
-- Name: TABLE tournament_results; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournament_results TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournament_results TO authenticated;


--
-- Name: TABLE tournaments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournaments TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tournaments TO authenticated;


--
-- PostgreSQL database dump complete
--

\unrestrict UgrCv8Kn2Lu8o2fbweR2E2sgVYsgh7KYcShUBGuGGD40c0odOJgqblPtZARezvt

