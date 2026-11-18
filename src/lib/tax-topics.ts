export const TAX_TOPICS = ["filing_status", "dependents", "income", "deductions", "credits", "investments"] as const;
export type TaxTopic = (typeof TAX_TOPICS)[number];

const topicPatterns: Record<TaxTopic, RegExp> = {
  filing_status: /\b(filing status(?:es)?|single|married|marriage|divorced|head of household|surviving spouse|widow|widower|jointly|separately)\b/i,
  dependents: /\b(dependent[s]?|qualifying child|qualifying relative|claim my (child|parent|mother|father)|residency|support test|claim(?:s|ed|ing)? me|filing requirements?|filing thresholds?|(?:need|have|required) to file|must file|earned income|unearned income)\b/i,
  income: /\b(income|wages|w-?2|salary|interest|unemployment|compensation|agi|adjusted gross|taxable|nontaxable|social security|ira|roth|retirement)\b/i,
  deductions: /\b(deduction[s]?|deduct|itemiz\w*|schedule a|mortgage|charit\w*|medical expenses|salt)\b/i,
  credits: /\b(credit[s]?|eitc|eic|aotc|llc|tuition|education|childcare|child care|saver)\b/i,
  investments: /\b(invest\w*|capital|gain[s]?|loss(?:es)?|stock[s]?|bond[s]?|dividend[s]?|basis|holding period|long.term|short.term|wash sale|carryforward[s]?|crypto\w*|bitcoin|digital asset[s]?|sell|selling|sale)\b/i,
};

export function identifyTaxTopics(question: string): TaxTopic[] {
  return TAX_TOPICS.filter((topic) => topicPatterns[topic].test(question));
}

export const TOPIC_FACTS: Record<TaxTopic, string> = {
  filing_status: "tax year, marital status at year end, spouse's death year if relevant, household costs and qualifying person's relationship/residency",
  dependents: "tax year, relationship, age/student status, residency, support, income and joint-return circumstances; for a dependent's own filing requirement: tax year, marital status, age 65+/blindness, earned, unearned and gross income",
  income: "tax year, income type, and relevant circumstances; distinguish gross income from AGI",
  deductions: "tax year, filing status, expense type/amount, eligibility and AGI-dependent limits",
  credits: "tax year, filing status, income, child's age/residency or student's enrollment/expenses as relevant to the particular credit",
  investments: "tax year, asset type, holding dates, basis/proceeds and losses/carryforwards as relevant",
};