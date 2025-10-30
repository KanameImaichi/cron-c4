import { renderHtml } from "./renderHtml";

interface Event {
  id: number;
  start: string;
  end: string;
  status: string;
}

// Helper function to format date for SQLite compatibility
// SQLite stores dates as 'YYYY-MM-DD HH:MM:SS.SSS' format (space separator, no timezone)
// JavaScript's toISOString() returns 'YYYY-MM-DDTHH:MM:SS.SSSZ' format (T separator, Z timezone)
function formatDateForSQLite(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

// Check if two events overlap
function eventsOverlap(event1: Event, event2: Event): boolean {
  const start1 = new Date(event1.start).getTime();
  const end1 = new Date(event1.end).getTime();
  const start2 = new Date(event2.start).getTime();
  const end2 = new Date(event2.end).getTime();

  return start1 < end2 && start2 < end1;
}

// Group events by overlapping periods using Union-Find algorithm
// This handles transitive overlaps correctly (A overlaps B, B overlaps C => A, B, C in same group)
function groupOverlappingEvents(events: Event[]): Event[][] {
  if (events.length === 0) return [];
  
  // Union-Find data structure
  const parent = new Map<number, number>();
  
  // Initialize each event as its own parent
  for (const event of events) {
    parent.set(event.id, event.id);
  }
  
  // Find root with path compression
  function find(id: number): number {
    const parentId = parent.get(id);
    if (parentId === undefined) {
      throw new Error(`Event ID ${id} not found in parent map`);
    }
    if (parentId !== id) {
      parent.set(id, find(parentId));
    }
    return parent.get(id)!; // Safe to use ! here as we just set it
  }
  
  // Union two events
  function union(id1: number, id2: number): void {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      parent.set(root2, root1);
    }
  }
  
  // Check all pairs and union overlapping events
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (eventsOverlap(events[i], events[j])) {
        union(events[i].id, events[j].id);
      }
    }
  }
  
  // Group events by their root
  const groups = new Map<number, Event[]>();
  for (const event of events) {
    const root = find(event.id);
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, [event]);
    } else {
      group.push(event);
    }
  }
  
  return Array.from(groups.values());
}

// Perform lottery: select one winner from a group
function selectWinner(events: Event[]): Event {
  const randomIndex = Math.floor(Math.random() * events.length);
  return events[randomIndex];
}

// Main processing logic for events
async function processEvents(env: Env): Promise<string> {
  // Calculate date range for one week ahead
  const now = new Date();
  const oneWeekStart = new Date(now);
  oneWeekStart.setDate(now.getDate() + 7);
  oneWeekStart.setHours(0, 0, 0, 0);

  const oneWeekEnd = new Date(oneWeekStart);
  oneWeekEnd.setHours(23, 59, 59, 999);

  const startStr = formatDateForSQLite(oneWeekStart);
  const endStr = formatDateForSQLite(oneWeekEnd);

  let logMessages: string[] = [];
  logMessages.push(`Processing events between ${startStr} and ${endStr}`);

  // Query events that have their start or end within one week from now
  const query = `
    SELECT id, start, end, status
    FROM events
    WHERE status = 'pending'
      AND (
        (start >= ? AND start <= ?)
        OR (end >= ? AND end <= ?)
        OR (start <= ? AND end >= ?)
      )
  `;

  const { results: events } = await env.DB.prepare(query)
    .bind(startStr, endStr, startStr, endStr, startStr, endStr)
    .all<Event>();

  if (!events || events.length === 0) {
    const msg = "No pending events found for one week ahead";
    console.log(msg);
    logMessages.push(msg);
    return logMessages.join('\n');
  }

  const msg = `Found ${events.length} events for processing`;
  console.log(msg);
  logMessages.push(msg);

  // Group overlapping events
  const groups = groupOverlappingEvents(events);
  logMessages.push(`Grouped into ${groups.length} group(s)`);

  // Process each group
  for (const group of groups) {
    if (group.length === 1) {
      // No overlap, set status to confirm
      await env.DB.prepare(
        "UPDATE events SET status = 'confirm' WHERE id = ?"
      ).bind(group[0].id).run();
      const msg = `Event ${group[0].id} confirmed (no overlap)`;
      console.log(msg);
      logMessages.push(msg);
    } else {
      // Overlapping events - perform lottery
      const winner = selectWinner(group);
      const msg = `Group of ${group.length} overlapping events, winner: ${winner.id}`;
      console.log(msg);
      logMessages.push(msg);

      // Set winner to confirm
      await env.DB.prepare(
        "UPDATE events SET status = 'confirm' WHERE id = ?"
      ).bind(winner.id).run();

      // Set losers to failed
      const loserIds = group.filter(e => e.id !== winner.id).map(e => e.id);
      if (loserIds.length > 0) {
        const placeholders = loserIds.map(() => '?').join(',');
        await env.DB.prepare(
          `UPDATE events SET status = 'failed' WHERE id IN (${placeholders})`
        ).bind(...loserIds).run();
        const msg = `Events ${loserIds.join(', ')} failed (lost lottery)`;
        console.log(msg);
        logMessages.push(msg);
      }
    }
  }

  const finalMsg = "Event status update completed";
  console.log(finalMsg);
  logMessages.push(finalMsg);

  return logMessages.join('\n');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test endpoint to manually trigger the scheduled logic
    if (url.pathname === '/test-scheduled') {
      const log = await processEvents(env);
      
      // Show results
      const { results: allEvents } = await env.DB.prepare(
        "SELECT id, start, end, status FROM events ORDER BY id"
      ).all<Event>();

      return new Response(
        JSON.stringify({
          log: log.split('\n'),
          events: allEvents
        }, null, 2),
        {
          headers: { "content-type": "application/json" },
        }
      );
    }

    // Default endpoint
    const stmt = env.DB.prepare("SELECT * FROM comments LIMIT 3");
    const { results } = await stmt.all();

    return new Response(renderHtml(JSON.stringify(results, null, 2)), {
      headers: {
        "content-type": "text/html",
      },
    });
  },

  async scheduled(controller, env, ctx) {
    await processEvents(env);
  },
} satisfies ExportedHandler<Env>;
