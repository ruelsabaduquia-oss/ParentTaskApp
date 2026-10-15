# Math and Science Quizzes

All quiz types accept Unicode symbols and KaTeX/LaTeX equations in questions,
choices, answers, and explanations. Formula rendering is packaged locally in the
Android apps; it does not load scripts or fonts from an external CDN.

In the quiz builder, open Math & Science, select a template, edit Formula, and
click Insert Equation. The equation is inserted at the cursor in the last focused
question, choice, answer, or explanation field. The existing Preview Child View
shows the rendered quiz. CSV uploads and pasted questions use the same notation.

Use `\(...\)` for inline formulas and `\[...\]` or `$$...$$` for display formulas.
Single dollar signs remain ordinary text to avoid interpreting prices as math.

| Topic | Example |
| --- | --- |
| Summation | `\(\sum_{n=1}^{10} n^2\)` |
| Algebra | `\(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)` |
| Calculus | `\(\int_0^1 x^2\,dx\)` |
| Derivative | `\(\frac{d}{dx}(x^2)=2x\)` |
| Limit | `\(\lim_{x\to 0}\frac{\sin x}{x}=1\)` |
| Physics | `\(\vec{F}=m\vec{a}\)` |
| Units | `\(9.8\,\mathrm{m/s^2}\)` |
| Chemical reaction | `\(\ce{2H2 + O2 -> 2H2O}\)` |
| Chemical ion | `\(\ce{SO4^2-}\)` |

Save CSV files as UTF-8. Backslashes are literal characters in CSV; do not double
them. Put cells containing commas or newlines inside double quotes. Double any
literal double quote inside a quoted CSV cell.

## Answer Grading

Multiple choice still grades the selected letter. Ordinary typed answers remain
case-insensitive. An answer key explicitly wrapped as a formula preserves case:
`\(\ce{CO}\)` accepts `CO`, but rejects `Co`. Children can omit the outer formula
delimiters and, for chemical formulas, the outer `\ce{...}` wrapper when typing.

This is equation display and exact-answer grading, not a computer algebra system.
It does not solve equations, balance reactions, convert units, or prove equivalent
answers. `1/2`, `0.5`, and `50%` are not automatically interchangeable. For complex
notation, multiple choice is the simplest way to avoid typing ambiguity.

No database migration is needed; existing text columns store the notation.
