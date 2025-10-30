-- Migration number: 0002 	 2025-10-30T05:45:00.000Z
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start DATETIME NOT NULL,
    end DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert some sample data for testing
INSERT INTO events (start, end, status) VALUES
    -- Events one week from now (overlapping)
    (datetime('now', '+7 days', '+9 hours'), datetime('now', '+7 days', '+11 hours'), 'pending'),
    (datetime('now', '+7 days', '+10 hours'), datetime('now', '+7 days', '+12 hours'), 'pending'),
    -- Events one week from now (non-overlapping)
    (datetime('now', '+7 days', '+14 hours'), datetime('now', '+7 days', '+16 hours'), 'pending'),
    -- Events not one week ahead (should not be processed)
    (datetime('now', '+2 days'), datetime('now', '+2 days', '+2 hours'), 'pending'),
    (datetime('now', '+14 days'), datetime('now', '+14 days', '+2 hours'), 'pending');
