-- ============================================================
-- 理髮店 LINE 預約系統 資料庫綱要 (Supabase / PostgreSQL)
-- ============================================================

-- ============================================================
-- 1. 設計師資料表
-- ============================================================
CREATE TABLE IF NOT EXISTS stylists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    line_uid    TEXT,                          -- 設計師自己的 LINE UID（選填，用於通知）
    avatar_url  TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE, -- false = 暫停接單（請假）
    sort_order  INT NOT NULL DEFAULT 0,        -- 顯示排序
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. 設計師排班模板 (週間固定排班)
-- ============================================================
CREATE TABLE IF NOT EXISTS stylist_schedules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stylist_id  UUID NOT NULL REFERENCES stylists(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 1=Mon ... 6=Sat
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (stylist_id, day_of_week)
);

-- ============================================================
-- 3. 服務項目資料表
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    duration_min INT NOT NULL DEFAULT 30,  -- 服務預估時長（分鐘）
    price        NUMERIC(10,2),
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. 預約時段模板 (週間固定開放時段)
-- ============================================================
CREATE TABLE IF NOT EXISTS slot_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time    TIME NOT NULL,
    duration_min  INT NOT NULL DEFAULT 30,
    max_capacity  INT NOT NULL DEFAULT 1,   -- 同時段最多可接幾位客人（跨設計師合計，或每位設計師）
    is_open       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (day_of_week, start_time)
);

-- ============================================================
-- 5. 特定日期時段覆蓋 (假日/特殊日手動開關)
-- ============================================================
CREATE TABLE IF NOT EXISTS slot_overrides (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date          DATE NOT NULL,
    start_time    TIME NOT NULL,
    duration_min  INT NOT NULL DEFAULT 30,
    max_capacity  INT NOT NULL DEFAULT 1,
    is_open       BOOLEAN NOT NULL DEFAULT TRUE,  -- false = 關閉此時段
    note          TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (date, start_time)
);

-- ============================================================
-- 6. 客人資料表
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_uid     TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    picture_url  TEXT,
    notes        TEXT,                          -- 店家備註（如：偏好、過敏注意）
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. 預約資料表
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT UNIQUE NOT NULL,    -- 人類可讀預約編號，如 HS-20241001-001
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    stylist_id          UUID REFERENCES stylists(id) ON DELETE SET NULL,  -- NULL = 不限設計師
    service_id          UUID REFERENCES services(id) ON DELETE SET NULL,
    date                DATE NOT NULL,
    start_time          TIME NOT NULL,
    duration_min        INT NOT NULL DEFAULT 30,
    status              TEXT NOT NULL DEFAULT 'confirmed'
                            CHECK (status IN ('pending','confirmed','arrived','no_show','cancelled')),
    cancel_reason       TEXT,
    cancelled_by        TEXT CHECK (cancelled_by IN ('customer','admin')),
    reminder_24h_sent   BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_1h_sent    BOOLEAN NOT NULL DEFAULT FALSE,
    notes               TEXT,                    -- 客人備註
    admin_notes         TEXT,                    -- 店家內部備註
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_stylist_id ON appointments(stylist_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_reminders ON appointments(date, reminder_24h_sent, reminder_1h_sent)
    WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_customers_line_uid ON customers(line_uid);
CREATE INDEX IF NOT EXISTS idx_stylist_schedules_stylist ON stylist_schedules(stylist_id);

-- ============================================================
-- 自動更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_stylists_updated_at
    BEFORE UPDATE ON stylists FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE OR REPLACE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE OR REPLACE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE OR REPLACE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- 初始種子資料 (Seed Data)
-- ============================================================

-- 預設服務項目
INSERT INTO services (name, duration_min, price, sort_order) VALUES
    ('一般剪髮', 30, 300, 1),
    ('洗髮 + 剪髮', 45, 400, 2),
    ('燙髮', 120, 1500, 3),
    ('染髮', 90, 1200, 4),
    ('洗髮 + 護髮', 45, 500, 5)
ON CONFLICT DO NOTHING;

-- 預設週間時段模板 (週二~週日，10:00-19:00，每30分鐘一個時段)
-- 週二至週六
DO $$
DECLARE
    dow SMALLINT;
    slot_time TIME;
BEGIN
    FOR dow IN 2..6 LOOP  -- 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
        slot_time := '10:00'::TIME;
        WHILE slot_time < '19:00'::TIME LOOP
            INSERT INTO slot_templates (day_of_week, start_time, duration_min, max_capacity, is_open)
            VALUES (dow, slot_time, 30, 2, TRUE)
            ON CONFLICT (day_of_week, start_time) DO NOTHING;
            slot_time := slot_time + INTERVAL '30 minutes';
        END LOOP;
    END LOOP;
    -- 週日 (0) 10:00-17:00
    slot_time := '10:00'::TIME;
    WHILE slot_time < '17:00'::TIME LOOP
        INSERT INTO slot_templates (day_of_week, start_time, duration_min, max_capacity, is_open)
        VALUES (0, slot_time, 30, 2, TRUE)
        ON CONFLICT (day_of_week, start_time) DO NOTHING;
        slot_time := slot_time + INTERVAL '30 minutes';
    END LOOP;
END $$;
