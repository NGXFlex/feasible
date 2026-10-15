/* ------------------------------------------------------------------ */
/*  Day-by-day sharing of study time between subjects.                  */
/*  Plain arithmetic, no React.                                         */
/*                                                                      */
/*  Every day, the hours available are shared between all subjects whose */
/*  exam is still ahead. Each subject's claim is its remaining workload  */
/*  divided by the days it has left, so a nearer exam pulls harder.      */
/*  If the day cannot cover every claim, each gets a proportional share  */
/*  and the deficit shows up as a shortfall. No hour is spent twice.     */
/* ------------------------------------------------------------------ */

const dayMs = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nextDay = (d) => { const x = new Date(d); x.setDate(x.getDate() + 1); return startOfDay(x); };

/* subjects: [{ need, date }]   need in hours, date = exam day
   hoursOn(day) -> study hours on that day

   For each subject, in input order:
     days       [{ d, h }] hours actually given to it, day by day (the schedule)
     allocated  sum of those hours (never more than need)
     recovered  hours left unused on days before its exam that it still
                needed: the even-rate schedule didn't hand them over, but
                they were there to use, so they count against its shortfall
     spare      its own share of the hours nobody needed
     available  allocated + recovered + spare

   Each unused hour is credited to exactly one subject. On every day, the
   leftover first covers subjects that would otherwise end up short; what
   remains is split between the subjects whose exams are still ahead, in
   proportion to what each claimed that day (evenly when nobody claimed).
   So the available hours add up to the real capacity, and a subject is
   never both short and holding spare.
   spare (top level): all the unneeded hours, each counted once. */
export function shareDays(subjects, hoursOn, today = new Date()) {
  const n = subjects.length;
  const exam = subjects.map((s) => startOfDay(s.date));
  const left = subjects.map((s) => Math.max(0, s.need));
  const days = subjects.map(() => []);
  const free = [];   // [{ h, ahead: [i], claim: { i: rate } }] per day with hours left over
  if (!n) return { subjects: [], spare: 0, capacity: 0 };

  const stop = exam.reduce((a, b) => (b > a ? b : a));
  let capacity = 0;
  let cur = startOfDay(today);
  let guard = 0;
  while (cur < stop && guard++ < 800) {
    const hours = hoursOn(cur);
    if (hours > 0) {
      capacity += hours;
      const ahead = [];
      const active = [];
      for (let i = 0; i < n; i++) {
        const daysLeft = Math.round((exam[i] - cur) / dayMs);
        if (daysLeft <= 0) continue;
        ahead.push(i);
        if (left[i] > 1e-9) active.push({ i, rate: left[i] / daysLeft });
      }
      const totalRate = active.reduce((t, a) => t + a.rate, 0);
      let used = 0;
      for (const a of active) {
        const share = totalRate <= hours ? a.rate : hours * (a.rate / totalRate);
        const give = Math.min(share, left[a.i]);
        if (give > 1e-9) {
          days[a.i].push({ d: new Date(cur), h: give });
          left[a.i] -= give;
          used += give;
        }
      }
      if (hours - used > 1e-9) {
        free.push({ h: hours - used, ahead, claim: Object.fromEntries(active.map((a) => [a.i, a.rate])) });
      }
    }
    cur = nextDay(cur);
  }

  /* credit every leftover hour to one subject */
  const unmet = [...left];
  const recovered = subjects.map(() => 0);
  const spare = subjects.map(() => 0);
  for (const day of free) {
    let h = day.h;
    // 1. subjects that still end up short take what they can use
    const short = day.ahead.filter((i) => unmet[i] > 1e-9);
    const want = short.reduce((t, i) => t + unmet[i], 0);
    if (want > 1e-9) {
      const give = Math.min(h, want);
      for (const i of short) {
        const g = give * (unmet[i] / want);
        recovered[i] += g;
        unmet[i] -= g;
      }
      h -= give;
    }
    if (h <= 1e-9) continue;
    // 2. the rest is spare, shared by that day's claims
    const totalClaim = day.ahead.reduce((t, i) => t + (day.claim[i] ?? 0), 0);
    for (const i of day.ahead) {
      spare[i] += totalClaim > 1e-9 ? h * ((day.claim[i] ?? 0) / totalClaim) : h / day.ahead.length;
    }
  }

  return {
    subjects: subjects.map((_, i) => {
      const allocated = days[i].reduce((t, x) => t + x.h, 0);
      return {
        days: days[i], allocated, recovered: recovered[i], spare: spare[i],
        available: allocated + recovered[i] + spare[i],
      };
    }),
    spare: spare.reduce((a, b) => a + b, 0),
    capacity,
  };
}
