import { renderHtml } from "./renderHtml";

interface Event {
  id: number;
  start: string;
  end: string;
  status: string;
}

// Check if two events overlap
function eventsOverlap(event1: Event, event2: Event): boolean {
  const start1 = new Date(event1.start).getTime();
  const end1 = new Date(event1.end).getTime();
  const start2 = new Date(event2.start).getTime();
  const end2 = new Date(event2.end).getTime();

  return start1 < end2 && start2 < end1;
}

// Group events by overlapping periods
function groupOverlappingEvents(events: Event[]): Event[][] {
  const groups: Event[][] = [];
  const processed = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    if (processed.has(events[i].id)) continue;

    const group: Event[] = [events[i]];
    processed.add(events[i].id);

    for (let j = i + 1; j < events.length; j++) {
      if (processed.has(events[j].id)) continue;

      // Check if this event overlaps with any event in the current group
      if (group.some(event => eventsOverlap(event, events[j]))) {
        group.push(events[j]);
        processed.add(events[j].id);
      }
    }

    groups.push(group);
  }

  return groups;
}

// Perform lottery: select one winner from a group
function selectWinner(events: Event[]): Event {
  const randomIndex = Math.floor(Math.random() * events.length);
  return events[randomIndex];
}

export default {
  async fetch(request, env) {
    const stmt = env.DB.prepare("SELECT * FROM comments LIMIT 3");
    const { results } = await stmt.all();

    return new Response(renderHtml(JSON.stringify(results, null, 2)), {
      headers: {
        "content-type": "text/html",
      },
    });
  },

  async scheduled(controller, env, ctx) {
    // Calculate date range for one week ahead
    const now = new Date();
    const oneWeekStart = new Date(now);
    oneWeekStart.setDate(now.getDate() + 7);
    oneWeekStart.setHours(0, 0, 0, 0);

    const oneWeekEnd = new Date(oneWeekStart);
    oneWeekEnd.setHours(23, 59, 59, 999);

    const startStr = oneWeekStart.toISOString();
    const endStr = oneWeekEnd.toISOString();

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
      console.log("No pending events found for one week ahead");
      return;
    }

    console.log(`Found ${events.length} events for processing`);

    // Group overlapping events
    const groups = groupOverlappingEvents(events);

    // Process each group
    for (const group of groups) {
      if (group.length === 1) {
        // No overlap, set status to confirm
        await env.DB.prepare(
          "UPDATE events SET status = 'confirm' WHERE id = ?"
        ).bind(group[0].id).run();
        console.log(`Event ${group[0].id} confirmed (no overlap)`);
      } else {
        // Overlapping events - perform lottery
        const winner = selectWinner(group);
        console.log(`Group of ${group.length} overlapping events, winner: ${winner.id}`);

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
          console.log(`Events ${loserIds.join(', ')} failed (lost lottery)`);
        }
      }
    }

    console.log("Event status update completed");
  },
} satisfies ExportedHandler<Env>;
