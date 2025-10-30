# Cron Job Event Status Confirmation

This document describes the automated event status confirmation system implemented in this CloudflareWorker.

## Overview

The worker includes a scheduled job that runs daily at midnight to process events from the D1 database. It selects events scheduled one week ahead and updates their status based on availability and overlap detection.

## How It Works

### Scheduled Execution
- **Schedule**: Daily at midnight (0:00 UTC)
- **Cron Expression**: `0 0 * * *`

### Processing Logic

1. **Query Events**: Selects all events with status='Pending' where start or end dates fall within one week from now

2. **Overlap Detection**: Uses Union-Find algorithm to group overlapping events, including transitive overlaps
   - Example: If Event A overlaps with Event B, and Event B overlaps with Event C, all three events are grouped together even if A and C don't directly overlap

3. **Lottery System**: For each group of overlapping events:
   - **Single event**: Automatically set to `status='Approved'`
   - **Multiple overlapping events**: Random lottery selection
     - Winner: `status='Approved'`
     - Losers: `status='UnApproved'`

### Database Schema

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start DATETIME NOT NULL,
    end DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Status Values
- `Pending`: Initial state, awaiting processing
- `Approved`: Event approved (no overlap or won lottery)
- `UnApproved`: Event unapproved (lost lottery to overlapping event)

## Testing

### Manual Testing via Test Endpoint

You can manually trigger the scheduled logic by accessing:

```
GET /test-scheduled
```

This endpoint returns:
- Processing logs
- Current state of all events

### Example Response

```json
{
  "log": [
    "Processing events between 2025-11-06 00:00:00.000 and 2025-11-06 23:59:59.999",
    "Found 3 events for processing",
    "Grouped into 2 group(s)",
    "Group of 2 overlapping events, winner: 1",
    "Events 2 unapproved (lost lottery)",
    "Event 3 approved (no overlap)",
    "Event status update completed"
  ],
  "events": [...]
}
```

### Local Development

```bash
# Apply migrations
npx wrangler d1 migrations apply DB --local

# Start dev server
npx wrangler dev --local

# Test the endpoint
curl http://localhost:8787/test-scheduled
```

## Deployment

```bash
# Apply migrations to production
npx wrangler d1 migrations apply DB --remote

# Deploy worker
npx wrangler deploy
```

The cron job will automatically run at midnight UTC once deployed.

## Technical Details

### Overlap Detection Algorithm

Uses Union-Find (Disjoint Set Union) data structure with path compression:
- **Time Complexity**: O(n² log n) where n is the number of events
- **Space Complexity**: O(n)
- **Handles**: Transitive overlaps correctly

### Date Handling

- JavaScript Date objects are converted to SQLite-compatible format
- Format: `YYYY-MM-DD HH:MM:SS.SSS` (space separator, no timezone)
- Timezone: All times are in UTC

### Random Selection

- Uses `Math.random()` for lottery selection
- Equal probability for all overlapping events in a group

## Example Scenarios

### Scenario 1: Simple Overlap
```
Event A: 9:00-11:00
Event B: 10:00-12:00
Result: Random selection, one approves, one gets unapproved
```

### Scenario 2: Transitive Overlap
```
Event A: 9:00-10:00
Event B: 9:30-10:30  (overlaps both A and C)
Event C: 10:00-11:00
Result: All three in same group, one random winner, two unapproved
```

### Scenario 3: No Overlap
```
Event A: 9:00-11:00
Event B: 14:00-16:00
Result: Both automatically approved
```

### Scenario 4: Outside Time Window
```
Current date: Oct 30
Event A: Nov 1 (only 2 days ahead)
Event B: Nov 15 (15 days ahead)
Result: Both ignored, remain Pending
```
