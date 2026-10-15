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
     days        [{ d, h }] hours actually given to it, day by day
     allocated   sum of those hours (never more than need)
     spareBefore hours nobody needed, on days before its exam
     available   allocated + spareBefore: everything it could have used.
                 The same spare hour shows up for every subject whose exam
                 comes after it, because any one of them could take it.
   spare: unneeded hours across the whole run, each counted once. */
export function shareDays(subjects, hoursOn, today = new Date()) {
  const n = subjects.length;
  const exam = subjects.map((s) => startOfDay(s.date));
  const left = subjects.map((s) => Math.max(0, s.need));
  const days = subjects.map(() => []);
  const free = [];   // [{ d, h }] hours left over each day
  if (!n) return { subjects: [], spare: 0 };

  const stop = exam.reduce((a, b) => (b > a ? b : a));
  let cur = startOfDay(today);
  let guard = 0;
  while (cur < stop && guard++ < 800) {
    const hours = hoursOn(cur);
    if (hours > 0) {
      const active = [];
      for (let i = 0; i < n; i++) {
        if (left[i] <= 1e-9) continue;
        const daysLeft = Math.round((exam[i] - cur) / dayMs);
        if (daysLeft > 0) active.push({ i, rate: left[i] / daysLeft });
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
      if (hours - used > 1e-9) free.push({ d: new Date(cur), h: hours - used });
    }
    cur = nextDay(cur);
  }

  return {
    subjects: subjects.map((_, i) => {
      const allocated = days[i].reduce((t, x) => t + x.h, 0);
      const spareBefore = free.filter((x) => x.d < exam[i]).reduce((t, x) => t + x.h, 0);
      return { days: days[i], allocated, spareBefore, available: allocated + spareBefore };
    }),
    spare: free.reduce((t, x) => t + x.h, 0),
  };
}
