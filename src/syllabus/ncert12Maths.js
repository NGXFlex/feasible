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
    papers:
      "Chapter marks and exercise yield come from CBSE's official sample papers below. " +
      "Each question is tagged with the NCERT exercise it practises; an OR question's marks " +
      "are split between its alternatives, and a question that uses two exercises is split " +
      "between them. Two papers are a small sample, so treat the result as a guide.",
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

  /* CBSE sample question papers, one row per question:
       [question, marks, alternative, alternative, ...]
     An alternative is the exercise(s) it practises, written "7.2" or
     "7.2+7.4", and "8.Misc" for a chapter's Miscellaneous Exercise.
     Two alternatives means an internal OR choice. */
  papers: [
    {
      id: "sqp-2026-27",
      title: "CBSE Sample Question Paper 2026-27",
      url: "https://cbseacademic.nic.in/web_material/SQP/ClassXII_2026_27/Maths-SQP.pdf",
      questions: [
        ["1", 1, "2.1"], ["2", 1, "2.1"], ["3", 1, "2.1"], ["4", 1, "3.3"], ["5", 1, "4.4"],
        ["6", 1, "3.2"], ["7", 1, "5.3"], ["8", 1, "5.1"], ["9", 1, "6.2"], ["10", 1, "5.2"],
        ["11", 1, "9.1"], ["12", 1, "7.2"], ["13", 1, "10.2"], ["14", 1, "10.2"], ["15", 1, "10.4"],
        ["16", 1, "13.2"], ["17", 1, "13.1"], ["18", 1, "13.2"], ["19", 1, "7.10"], ["20", 1, "9.2"],
        ["21", 2, "7.2", "7.2+7.4"], ["22", 2, "5.3"], ["23", 2, "11.1", "10.2"], ["24", 2, "10.4"],
        ["25", 2, "12.1"],
        ["26", 3, "3.2+4.4"], ["27", 3, "6.1"], ["28", 3, "5.6+5.7", "5.5"], ["29", 3, "9.5", "9.4"],
        ["30", 3, "11.2", "11.2"], ["31", 3, "12.1"],
        ["32", 5, "1.1", "1.2"], ["33", 5, "7.10"], ["34", 5, "8.1+8.Misc", "8.1+8.Misc"], ["35", 5, "13.3"],
        ["36", 4, "11.2"], ["37", 4, "6.3"], ["38", 4, "4.5"],
      ],
    },
    {
      id: "sqp-2025-26",
      title: "CBSE Sample Question Paper 2025-26",
      url: "https://cbseacademic.nic.in/web_material/SQP/ClassXII_2025_26/Maths-SQP.pdf",
      questions: [
        ["1", 1, "2.1"], ["2", 1, "3.2"], ["3", 1, "3.3"], ["4", 1, "4.4"], ["5", 1, "3.4"],
        ["6", 1, "4.1"], ["7", 1, "5.1"], ["8", 1, "5.3"], ["9", 1, "6.2"], ["10", 1, "9.3"],
        ["11", 1, "7.10"], ["12", 1, "7.2"], ["13", 1, "10.3"], ["14", 1, "10.2"], ["15", 1, "10.3"],
        ["16", 1, "12.1"], ["17", 1, "12.1"], ["18", 1, "13.1"], ["19", 1, "2.1"], ["20", 1, "10.4"],
        ["21", 2, "2.1", "2.1"], ["22", 2, "5.2"], ["23", 2, "7.6", "8.1"], ["24", 2, "5.2"],
        ["25", 2, "10.4"],
        ["26", 3, "5.5", "5.6+5.7"], ["27", 3, "6.1"], ["28", 3, "7.10", "8.1+8.Misc"],
        ["29", 3, "11.2", "11.2"], ["30", 3, "12.1"], ["31", 3, "13.2"],
        ["32", 5, "4.5"], ["33", 5, "7.10", "7.5"], ["34", 5, "9.5", "9.4"], ["35", 5, "11.2"],
        ["36", 4, "1.1"], ["37", 4, "6.3"], ["38", 4, "13.3"],
      ],
    },
  ],

  /* exercises: ex = NCERT label, q = numbered questions, topic = what it
     practises, builds = exercises in this chapter to do before it.
     examples: solved examples in the chapter, including Miscellaneous
     Examples. needs: chapters to do first. */
  chapters: [
    {
      id: "m12-01", no: 1, name: "Relations and Functions", unit: "u1",
      exercises: [
        { ex: "1.1", q: 16, topic: "Types of relations: reflexive, symmetric, transitive, equivalence", builds: [] },
        { ex: "1.2", q: 12, topic: "Types of functions: one-one and onto", builds: [] },
        { ex: "Misc", q: 7, topic: "Mixed practice", builds: ["1.1", "1.2"] },
      ],
      examples: 26, concept: 2, needs: [],
      why: "Definitions-heavy. Proving reflexive, symmetric, transitive or one-one and onto is short once the pattern clicks.",
    },
    {
      id: "m12-02", no: 2, name: "Inverse Trigonometric Functions", unit: "u1",
      exercises: [
        { ex: "2.1", q: 14, topic: "Principal values, domain and range", builds: [] },
        {
          ex: "2.2", q: 15, topic: "Properties of inverse trigonometric functions", builds: ["2.1"],
          scope: "The CBSE 2026-27 syllabus lists definition, domain, range, principal value branch and graphs only.",
        },
        { ex: "Misc", q: 14, topic: "Mixed practice", builds: ["2.1"] },
      ],
      examples: 6, concept: 2, needs: [],
      why: "Principal values and graphs. Small and rule-based.",
      scope: "CBSE 2026-27 lists definition, domain, range, principal value branch and graphs. Exercise 2.2 also practises properties; it is counted because the NCERT book includes it.",
    },
    {
      id: "m12-03", no: 3, name: "Matrices", unit: "u2",
      exercises: [
        { ex: "3.1", q: 10, topic: "Order and types of matrices", builds: [] },
        { ex: "3.2", q: 22, topic: "Addition, scalar and matrix multiplication", builds: ["3.1"] },
        { ex: "3.3", q: 12, topic: "Transpose, symmetric and skew-symmetric matrices", builds: ["3.2"] },
        { ex: "3.4", q: 1, topic: "Invertible matrices", builds: ["3.2"] },
        { ex: "Misc", q: 11, topic: "Mixed practice", builds: ["3.3", "3.4"] },
      ],
      examples: 25, concept: 2, needs: [],
      why: "Mechanical operations. The usual trap is the order of multiplication.",
    },
    {
      id: "m12-04", no: 4, name: "Determinants", unit: "u2",
      exercises: [
        { ex: "4.1", q: 8, topic: "Evaluating determinants up to 3 × 3", builds: [] },
        { ex: "4.2", q: 5, topic: "Area of a triangle", builds: ["4.1"] },
        { ex: "4.3", q: 5, topic: "Minors and cofactors", builds: ["4.1"] },
        { ex: "4.4", q: 18, topic: "Adjoint and inverse of a matrix", builds: ["4.3"] },
        { ex: "4.5", q: 16, topic: "Solving linear equations with the inverse", builds: ["4.4"] },
        { ex: "Misc", q: 9, topic: "Mixed practice", builds: ["4.5"] },
      ],
      examples: 19, concept: 3, needs: ["m12-03"],
      why: "Long calculations (adjoint, inverse, solving 3×3 systems) where one sign slip ruins the answer.",
    },
    {
      id: "m12-05", no: 5, name: "Continuity and Differentiability", unit: "u3",
      exercises: [
        { ex: "5.1", q: 34, topic: "Continuity", builds: [] },
        { ex: "5.2", q: 10, topic: "Chain rule for composite functions", builds: [] },
        { ex: "5.3", q: 15, topic: "Implicit functions and inverse-trig derivatives", builds: ["5.2"] },
        { ex: "5.4", q: 10, topic: "Exponential and logarithmic functions", builds: ["5.2"] },
        { ex: "5.5", q: 18, topic: "Logarithmic differentiation", builds: ["5.4"] },
        { ex: "5.6", q: 11, topic: "Parametric derivatives", builds: ["5.2"] },
        { ex: "5.7", q: 17, topic: "Second-order derivatives", builds: ["5.3", "5.4"] },
        { ex: "Misc", q: 22, topic: "Mixed practice", builds: ["5.1", "5.5", "5.6", "5.7"] },
      ],
      examples: 43, concept: 4, needs: ["m12-02"],
      why: "Many techniques to choose between: chain rule, implicit, logarithmic, parametric and second-order derivatives.",
    },
    {
      id: "m12-06", no: 6, name: "Application of Derivatives", unit: "u3",
      exercises: [
        { ex: "6.1", q: 18, topic: "Rate of change of quantities", builds: [] },
        { ex: "6.2", q: 19, topic: "Increasing and decreasing functions", builds: [] },
        { ex: "6.3", q: 29, topic: "Maxima and minima", builds: ["6.2"] },
        { ex: "Misc", q: 16, topic: "Mixed practice", builds: ["6.1", "6.3"] },
      ],
      examples: 37, concept: 4, needs: ["m12-05"],
      why: "Maxima and minima word problems make you build the function yourself before you can differentiate it.",
    },
    {
      id: "m12-07", no: 7, name: "Integrals", unit: "u3",
      exercises: [
        { ex: "7.1", q: 22, topic: "Antiderivatives and basic integrals", builds: [] },
        { ex: "7.2", q: 39, topic: "Integration by substitution", builds: ["7.1"] },
        { ex: "7.3", q: 24, topic: "Integration using trigonometric identities", builds: ["7.2"] },
        { ex: "7.4", q: 25, topic: "Standard forms like 1/(x² ± a²)", builds: ["7.2"] },
        { ex: "7.5", q: 23, topic: "Partial fractions", builds: ["7.2"] },
        { ex: "7.6", q: 24, topic: "Integration by parts", builds: ["7.2"] },
        { ex: "7.7", q: 11, topic: "Integrals of √(x² ± a²) and √(a² − x²)", builds: ["7.4", "7.6"] },
        { ex: "7.8", q: 22, topic: "Definite integrals (fundamental theorem)", builds: ["7.1"] },
        { ex: "7.9", q: 10, topic: "Definite integrals by substitution", builds: ["7.2", "7.8"] },
        { ex: "7.10", q: 21, topic: "Properties of definite integrals", builds: ["7.2", "7.8"] },
        { ex: "Misc", q: 40, topic: "Mixed practice", builds: ["7.3", "7.5", "7.7", "7.9", "7.10"] },
      ],
      examples: 42, concept: 5, needs: ["m12-05"],
      why: "The largest chapter. Picking the method (substitution, partial fractions, by parts, standard forms, definite-integral properties) is the hard part.",
    },
    {
      id: "m12-08", no: 8, name: "Application of Integrals", unit: "u3",
      exercises: [
        { ex: "8.1", q: 4, topic: "Area under simple curves", builds: [] },
        { ex: "Misc", q: 5, topic: "Areas bounded by curves and lines", builds: ["8.1"] },
      ],
      examples: 4, concept: 3, needs: ["m12-07"],
      why: "Short, but you have to sketch the region and integrate confidently.",
    },
    {
      id: "m12-09", no: 9, name: "Differential Equations", unit: "u3",
      exercises: [
        { ex: "9.1", q: 12, topic: "Order and degree", builds: [] },
        { ex: "9.2", q: 12, topic: "General and particular solutions", builds: ["9.1"] },
        { ex: "9.3", q: 23, topic: "Variables separable", builds: ["9.1"] },
        { ex: "9.4", q: 17, topic: "Homogeneous equations", builds: ["9.3"] },
        { ex: "9.5", q: 19, topic: "Linear equations (integrating factor)", builds: ["9.3"] },
        { ex: "Misc", q: 15, topic: "Mixed practice", builds: ["9.2", "9.4", "9.5"] },
      ],
      examples: 22, concept: 4, needs: ["m12-07"],
      why: "Spot the type (separable, homogeneous, linear), then integrate. Leans on Integrals.",
    },
    {
      id: "m12-10", no: 10, name: "Vector Algebra", unit: "u4",
      exercises: [
        { ex: "10.1", q: 5, topic: "Types of vectors", builds: [] },
        { ex: "10.2", q: 19, topic: "Components, magnitude, section formula", builds: ["10.1"] },
        { ex: "10.3", q: 18, topic: "Dot product and projection", builds: ["10.2"] },
        { ex: "10.4", q: 12, topic: "Cross product and area", builds: ["10.3"] },
        { ex: "Misc", q: 19, topic: "Mixed practice", builds: ["10.3", "10.4"] },
      ],
      examples: 30, concept: 3, needs: [],
      why: "Dot and cross product applications, and reading what the result means geometrically.",
    },
    {
      id: "m12-11", no: 11, name: "Three Dimensional Geometry", unit: "u4",
      exercises: [
        { ex: "11.1", q: 5, topic: "Direction cosines and direction ratios", builds: [] },
        { ex: "11.2", q: 15, topic: "Lines in space, angles, shortest distance", builds: ["11.1"] },
        { ex: "Misc", q: 5, topic: "Mixed practice", builds: ["11.2"] },
      ],
      examples: 10, concept: 3, needs: ["m12-10"],
      why: "Lines in space. Shortest distance between skew lines is the long one.",
    },
    {
      id: "m12-12", no: 12, name: "Linear Programming", unit: "u5",
      exercises: [
        { ex: "12.1", q: 10, topic: "Graphical method", builds: [] },
      ],
      examples: 5, concept: 1, needs: [],
      why: "Graphical method with up to three constraints. Procedural.",
    },
    {
      id: "m12-13", no: 13, name: "Probability", unit: "u6",
      exercises: [
        { ex: "13.1", q: 17, topic: "Conditional probability", builds: [] },
        { ex: "13.2", q: 18, topic: "Multiplication rule and independent events", builds: ["13.1"] },
        { ex: "13.3", q: 14, topic: "Total probability and Bayes' theorem", builds: ["13.2"] },
        { ex: "Misc", q: 13, topic: "Mixed practice", builds: ["13.3"] },
      ],
      examples: 24, concept: 3, needs: [],
      why: "Conditional probability and Bayes' theorem need careful reading of what is given.",
    },
  ],
};
