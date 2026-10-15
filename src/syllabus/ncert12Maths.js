/* ------------------------------------------------------------------ */
/*  NCERT Class 12 Mathematics — hand-built syllabus data.              */
/*                                                                      */
/*  This is the "placeholder" for an AI syllabus parser: a parser       */
/*  would return exactly this shape for any uploaded syllabus, and the  */
/*  engine (engine/syllabusEngine.js) works on the shape, not on this   */
/*  subject. Every number here is either copied from an official        */
/*  source or marked as an estimate.                                    */
/* ------------------------------------------------------------------ */

export const NCERT12_MATHS = {
  id: "ncert-12-maths",
  title: "NCERT Class 12 Mathematics",
  subject: "Mathematics",
  board: "CBSE",
  code: "041",
  session: "2026-27",
  totalMarks: 80,

  sources: {
    marks:
      "CBSE Curriculum 2026-27, Mathematics (Code 041), Class XII course structure. " +
      "Marks are official per unit. CBSE states \"No chapter wise weightage\", so every " +
      "chapter figure in this app is an estimate.",
    marksUrl: "https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/Maths_SecP2_2026-27.pdf",
    questions:
      "NCERT Mathematics Part I and Part II, rationalised edition, Reprint 2026-27. " +
      "Counted from each exercise's numbering, including the Miscellaneous Exercise. " +
      "Sub-parts like (i), (ii) are not counted separately.",
    // chapter PDFs lemh101–lemh106 (Part I) and lemh201–lemh207 (Part II)
    questionsUrl: "https://ncert.nic.in/textbook/pdf/lemh101.pdf",
    concept:
      "Concept difficulty (1 to 5) is an editorial estimate of how hard the ideas are, " +
      "separate from how many questions there are.",
  },

  /* Official CBSE 2026-27 Class XII unit marks (total 80, plus 20 internal). */
  units: [
    { id: "u1", name: "Relations and Functions", marks: 8 },
    { id: "u2", name: "Algebra", marks: 10 },
    { id: "u3", name: "Calculus", marks: 35 },
    { id: "u4", name: "Vectors and Three-Dimensional Geometry", marks: 14 },
    { id: "u5", name: "Linear Programming", marks: 5 },
    { id: "u6", name: "Probability", marks: 8 },
  ],

  /* exercises: [label, numbered questions]. examples: solved examples in the
     chapter, including Miscellaneous Examples. needs: chapters to do first. */
  chapters: [
    {
      id: "m12-01", no: 1, name: "Relations and Functions", unit: "u1",
      exercises: [["1.1", 16], ["1.2", 12], ["Misc", 7]],
      examples: 26, concept: 2, needs: [],
      why: "Definitions-heavy. Proving reflexive, symmetric, transitive or one-one and onto is short once the pattern clicks.",
    },
    {
      id: "m12-02", no: 2, name: "Inverse Trigonometric Functions", unit: "u1",
      exercises: [["2.1", 14], ["2.2", 15], ["Misc", 14]],
      examples: 6, concept: 2, needs: [],
      why: "Principal values and graphs. Small and rule-based.",
      scope: "CBSE 2026-27 lists definition, domain, range, principal value branch and graphs. Exercise 2.2 also practises properties; it is counted because the NCERT book includes it.",
    },
    {
      id: "m12-03", no: 3, name: "Matrices", unit: "u2",
      exercises: [["3.1", 10], ["3.2", 22], ["3.3", 12], ["3.4", 1], ["Misc", 11]],
      examples: 25, concept: 2, needs: [],
      why: "Mechanical operations. The usual trap is the order of multiplication.",
    },
    {
      id: "m12-04", no: 4, name: "Determinants", unit: "u2",
      exercises: [["4.1", 8], ["4.2", 5], ["4.3", 5], ["4.4", 18], ["4.5", 16], ["Misc", 9]],
      examples: 19, concept: 3, needs: ["m12-03"],
      why: "Long calculations (adjoint, inverse, solving 3×3 systems) where one sign slip ruins the answer.",
    },
    {
      id: "m12-05", no: 5, name: "Continuity and Differentiability", unit: "u3",
      exercises: [["5.1", 34], ["5.2", 10], ["5.3", 15], ["5.4", 10], ["5.5", 18], ["5.6", 11], ["5.7", 17], ["Misc", 22]],
      examples: 43, concept: 4, needs: ["m12-02"],
      why: "Many techniques to choose between: chain rule, implicit, logarithmic, parametric and second-order derivatives.",
    },
    {
      id: "m12-06", no: 6, name: "Application of Derivatives", unit: "u3",
      exercises: [["6.1", 18], ["6.2", 19], ["6.3", 29], ["Misc", 16]],
      examples: 37, concept: 4, needs: ["m12-05"],
      why: "Maxima and minima word problems make you build the function yourself before you can differentiate it.",
    },
    {
      id: "m12-07", no: 7, name: "Integrals", unit: "u3",
      exercises: [["7.1", 22], ["7.2", 39], ["7.3", 24], ["7.4", 25], ["7.5", 23], ["7.6", 24], ["7.7", 11], ["7.8", 22], ["7.9", 10], ["7.10", 21], ["Misc", 40]],
      examples: 42, concept: 5, needs: ["m12-05"],
      why: "The largest chapter. Picking the method (substitution, partial fractions, by parts, standard forms, definite-integral properties) is the hard part.",
    },
    {
      id: "m12-08", no: 8, name: "Application of Integrals", unit: "u3",
      exercises: [["8.1", 4], ["Misc", 5]],
      examples: 4, concept: 3, needs: ["m12-07"],
      why: "Short, but you have to sketch the region and integrate confidently.",
    },
    {
      id: "m12-09", no: 9, name: "Differential Equations", unit: "u3",
      exercises: [["9.1", 12], ["9.2", 12], ["9.3", 23], ["9.4", 17], ["9.5", 19], ["Misc", 15]],
      examples: 22, concept: 4, needs: ["m12-07"],
      why: "Spot the type (separable, homogeneous, linear), then integrate. Leans on Integrals.",
    },
    {
      id: "m12-10", no: 10, name: "Vector Algebra", unit: "u4",
      exercises: [["10.1", 5], ["10.2", 19], ["10.3", 18], ["10.4", 12], ["Misc", 19]],
      examples: 30, concept: 3, needs: [],
      why: "Dot and cross product applications, and reading what the result means geometrically.",
    },
    {
      id: "m12-11", no: 11, name: "Three Dimensional Geometry", unit: "u4",
      exercises: [["11.1", 5], ["11.2", 15], ["Misc", 5]],
      examples: 10, concept: 3, needs: ["m12-10"],
      why: "Lines in space. Shortest distance between skew lines is the long one.",
    },
    {
      id: "m12-12", no: 12, name: "Linear Programming", unit: "u5",
      exercises: [["12.1", 10]],
      examples: 5, concept: 1, needs: [],
      why: "Graphical method with up to three constraints. Procedural.",
    },
    {
      id: "m12-13", no: 13, name: "Probability", unit: "u6",
      exercises: [["13.1", 17], ["13.2", 18], ["13.3", 14], ["Misc", 13]],
      examples: 24, concept: 3, needs: [],
      why: "Conditional probability and Bayes' theorem need careful reading of what is given.",
    },
  ],
};
