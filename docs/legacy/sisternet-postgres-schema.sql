-- ============================================================
-- SISTERNET DATABASE SCHEMA
-- PostgreSQL 15+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  invite_code   TEXT,
  region        TEXT,                        -- loose geo e.g. "Kansas City"
  bio           TEXT,
  trusted_contacts JSONB DEFAULT '[]',       -- array of {username, notifyOn}
  reputation    INTEGER DEFAULT 0,
  post_count    INTEGER DEFAULT 0,
  is_moderator  BOOLEAN DEFAULT FALSE,
  is_banned     BOOLEAN DEFAULT FALSE,
  quick_exit_url TEXT DEFAULT 'https://weather.com',
  last_active   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_region   ON users(region);

-- ============================================================
-- INVITE CODES
-- ============================================================
CREATE TABLE invite_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  used_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invite_codes_code ON invite_codes(code);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias           TEXT NOT NULL,
  alert_level     TEXT NOT NULL DEFAULT 'yellow' CHECK (alert_level IN ('green','yellow','red')),
  -- encrypted fields (AES-256 in app layer)
  vehicle_enc     TEXT,
  phys_desc_enc   TEXT,
  notes_enc       TEXT,
  -- plain fields
  areas_seen      TEXT[],
  tags            TEXT[],
  report_count    INTEGER DEFAULT 1,
  last_seen_date  DATE,
  last_seen_area  TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_alert   ON clients(alert_level);
CREATE INDEX idx_clients_areas   ON clients USING GIN(areas_seen);
CREATE INDEX idx_clients_tags    ON clients USING GIN(tags);
CREATE INDEX idx_clients_alias   ON clients(alias);

-- ============================================================
-- CLIENT REVIEWS
-- ============================================================
CREATE TABLE client_reviews (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars_overall    SMALLINT NOT NULL CHECK (stars_overall BETWEEN 1 AND 5),
  stars_payment    SMALLINT CHECK (stars_payment BETWEEN 1 AND 5),
  stars_respect    SMALLINT CHECK (stars_respect BETWEEN 1 AND 5),
  stars_safety     SMALLINT CHECK (stars_safety BETWEEN 1 AND 5),
  stars_comms      SMALLINT CHECK (stars_comms BETWEEN 1 AND 5),
  body_enc      TEXT NOT NULL,               -- encrypted review text
  is_flagged    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_client ON client_reviews(client_id);
CREATE INDEX idx_reviews_author ON client_reviews(author_id);

-- ============================================================
-- VENUES
-- ============================================================
CREATE TABLE venues (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  venue_type        TEXT NOT NULL CHECK (venue_type IN ('motel','hotel','airbnb','private','other')),
  alert_level       TEXT NOT NULL DEFAULT 'yellow' CHECK (alert_level IN ('green','yellow','red')),
  address_rough     TEXT,                    -- neighborhood / cross street only, NOT exact
  region            TEXT,
  tags              TEXT[],
  notes_enc         TEXT,                    -- encrypted operational notes
  report_count      INTEGER DEFAULT 1,
  last_checked_date DATE,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_venues_alert  ON venues(alert_level);
CREATE INDEX idx_venues_region ON venues(region);
CREATE INDEX idx_venues_tags   ON venues USING GIN(tags);

-- ============================================================
-- VENUE REVIEWS
-- ============================================================
CREATE TABLE venue_reviews (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id              UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  author_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars_overall         SMALLINT NOT NULL CHECK (stars_overall BETWEEN 1 AND 5),
  stars_staff           SMALLINT CHECK (stars_staff BETWEEN 1 AND 5),
  stars_exit_access     SMALLINT CHECK (stars_exit_access BETWEEN 1 AND 5),
  stars_parking         SMALLINT CHECK (stars_parking BETWEEN 1 AND 5),
  stars_soundproofing   SMALLINT CHECK (stars_soundproofing BETWEEN 1 AND 5),
  stars_cleanliness     SMALLINT CHECK (stars_cleanliness BETWEEN 1 AND 5),
  body_enc              TEXT NOT NULL,
  is_flagged            BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_venue_reviews_venue  ON venue_reviews(venue_id);
CREATE INDEX idx_venue_reviews_author ON venue_reviews(author_id);

-- ============================================================
-- ALERTS
-- ============================================================
CREATE TABLE alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  region      TEXT,
  body_enc    TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '72 hours'),
  upvotes     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_severity   ON alerts(severity);
CREATE INDEX idx_alerts_region     ON alerts(region);
CREATE INDEX idx_alerts_is_active  ON alerts(is_active);
CREATE INDEX idx_alerts_expires    ON alerts(expires_at);

-- ============================================================
-- FORUM THREADS
-- ============================================================
CREATE TABLE forum_threads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  category    TEXT NOT NULL CHECK (category IN ('safety','rates','legal','resources','social','tech','admin')),
  title       TEXT NOT NULL,
  body_enc    TEXT NOT NULL,
  region      TEXT,
  is_pinned   BOOLEAN DEFAULT FALSE,
  is_locked   BOOLEAN DEFAULT FALSE,
  reply_count INTEGER DEFAULT 0,
  view_count  INTEGER DEFAULT 0,
  last_reply_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_threads_category ON forum_threads(category);
CREATE INDEX idx_threads_region   ON forum_threads(region);
CREATE INDEX idx_threads_pinned   ON forum_threads(is_pinned);

-- ============================================================
-- FORUM REPLIES
-- ============================================================
CREATE TABLE forum_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id   UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body_enc    TEXT NOT NULL,
  is_flagged  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_replies_thread ON forum_replies(thread_id);

-- ============================================================
-- CHECK-INS
-- ============================================================
CREATE TABLE checkins (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_desc_enc   TEXT,
  location_enc      TEXT,
  trusted_contact   TEXT,                    -- username of contact
  duration_minutes  INTEGER NOT NULL DEFAULT 60,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','safe','overdue','panic')),
  check_in_at       TIMESTAMPTZ DEFAULT NOW(),
  expected_end_at   TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  panic_at          TIMESTAMPTZ
);

CREATE INDEX idx_checkins_user   ON checkins(user_id);
CREATE INDEX idx_checkins_status ON checkins(status);

-- ============================================================
-- AUDIT LOG (mod actions)
-- ============================================================
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  meta        JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER venues_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Increment reply count on forum_threads
CREATE OR REPLACE FUNCTION increment_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE forum_threads
  SET reply_count = reply_count + 1,
      last_reply_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forum_reply_count AFTER INSERT ON forum_replies
  FOR EACH ROW EXECUTE FUNCTION increment_reply_count();

-- Expire old alerts automatically
CREATE OR REPLACE FUNCTION expire_alerts()
RETURNS void AS $$
BEGIN
  UPDATE alerts SET is_active = FALSE
  WHERE expires_at < NOW() AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED: system invite code for first user
-- ============================================================
INSERT INTO invite_codes (code, expires_at)
VALUES ('SISTER-INIT-0001', NOW() + INTERVAL '365 days');
