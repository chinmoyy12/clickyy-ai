import type { ColumnType, SheetColumn } from '../../tools/xlsx';

/**
 * Spreadsheet templates for the interactive Excel builder. Columns use a compact
 * notation: "Header|type" or "Header|type|=formula" (formulas refer to other columns
 * as {Header}) and an optional "|sum", "|avg" or "|none" for the totals row.
 */
export interface SheetTemplate {
  id: string;
  title: string;
  file: string;
  /** Phrases that identify this template, longest match wins. */
  keys: string[];
  columns: SheetColumn[];
  /** One example row (input columns only), read out as a hint. */
  example: string;
  /** Special flows instead of row-by-row entry. */
  generator?: 'loan';
}

const parseCols = (spec: string): SheetColumn[] =>
  spec.split(';').map((s) => {
    const [header, type, ...rest] = s.split('|').map((x) => x.trim());
    const col: SheetColumn = { header, type: type as ColumnType };
    for (const r of rest) {
      if (r.startsWith('=')) col.formula = r.slice(1);
      else if (r === 'sum' || r === 'none') col.total = r;
      else if (r === 'avg') col.total = 'average';
    }
    return col;
  });

const T = (id: string, title: string, file: string, keys: string[], cols: string, example: string, generator?: 'loan'): SheetTemplate =>
  ({ id, title, file, keys, columns: parseCols(cols), example, ...(generator ? { generator } : {}) });

export const SHEET_TEMPLATES: SheetTemplate[] = [
  T('budget', 'Monthly Personal Budget', 'Monthly_Personal_Budget', ['monthly personal budget', 'personal budget', 'monthly budget', 'household budget', 'budget planner', 'expense tracker', 'budget'],
    'Category|text; Type|text; Budgeted|money; Actual|money; Difference|money|={Budgeted}-{Actual}', 'Rent, fixed, 15000, 14500'),
  T('grocery', 'Household Grocery Tracker', 'Household_Grocery_Tracker', ['household grocery tracker', 'grocery tracker', 'grocery list', 'groceries', 'grocery'],
    'Item|text; Category|text; Store|text; Quantity|number|none; Unit Price|money|none; Cost|money|={Quantity}*{Unit Price}', 'Milk, dairy, Big Bazaar, 4, 60'),
  T('invoice', 'Freelance Client Invoice', 'Freelance_Client_Invoice', ['freelance client invoice', 'client invoice', 'invoice'],
    'Description|text; Hours|number|sum; Hourly Rate|money|none; Tax Rate|percent|none; Amount|money|={Hours}*{Hourly Rate}; Tax|money|={Amount}*{Tax Rate}; Line Total|money|={Amount}+{Tax}', 'Website design, 12, 1500, 18'),
  T('cashflow', 'Cash Flow Statement', 'Cash_Flow_Statement', ['small business cash flow statement', 'cash flow statement', 'cash flow', 'cashflow'],
    'Month|text; Opening Balance|money|none; Cash Inflows|money; Operating Outflows|money; Capital Expenses|money; Net Cash Flow|money|={Cash Inflows}-{Operating Outflows}-{Capital Expenses}; Closing Balance|money|={Opening Balance}+{Net Cash Flow}|none', 'January, 200000, 150000, 90000, 20000'),
  T('attendance', 'Employee Attendance and Leave Log', 'Employee_Attendance_Log', ['employee attendance and leave log', 'attendance and leave', 'employee attendance', 'attendance', 'leave log', 'leave tracker'],
    'Employee|text; Department|text; Working Days|integer|none; Days Present|integer|sum; Sick Leave|integer|sum; Paid Leave Balance|integer|sum; Attendance|percent|=IF({Working Days}=0,0,{Days Present}/{Working Days})|avg', 'Priya, Finance, 22, 20, 1, 8'),
  T('project', 'Project Task and Milestone Tracker', 'Project_Milestone_Tracker', ['project task and milestone tracker', 'milestone tracker', 'project tracker', 'task tracker', 'project plan', 'project'],
    'Task|text; Owner|text; Start Date|date; Due Date|date; Priority|text; Status|text; Duration (days)|integer|={Due Date}-{Start Date}|none', 'Design mockups, Amit, 2026-11-10, 2026-11-20, high, in progress'),
  T('sales', 'Sales Pipeline and CRM', 'Sales_Pipeline_CRM', ['sales pipeline and crm sheet', 'sales pipeline', 'crm sheet', 'crm', 'sales tracker', 'leads tracker'],
    'Lead|text; Company|text; Deal Value|money; Probability|percent|avg; Expected Close|date; Next Action|text; Weighted Value|money|={Deal Value}*{Probability}', 'Rahul Mehta, Acme, 250000, 60, 2026-12-15, send proposal'),
  T('inventory', 'Warehouse Inventory Stock Sheet', 'Warehouse_Inventory_Stock', ['warehouse inventory stock sheet', 'inventory stock', 'warehouse inventory', 'inventory', 'stock sheet', 'stock register'],
    'SKU|text; Description|text; Location|text; Quantity|integer|sum; Reorder Level|integer|none; Unit Cost|money|none; Stock Value|money|={Quantity}*{Unit Cost}; Reorder|text|=IF({Quantity}<={Reorder Level},"Reorder","OK")', 'SKU-101, USB cable, Rack A3, 120, 30, 85'),
  T('gradebook', 'Student Gradebook and GPA Calculator', 'Student_Gradebook_GPA', ['student gradebook and gpa calculator', 'student gradebook', 'gradebook', 'gpa calculator', 'grade book', 'grades', 'marksheet', 'mark sheet'],
    'Student|text; Assignment Score|number|avg; Exam Score|number|avg; Attendance|percent|avg; Final Score|number|=ROUND(0.4*{Assignment Score}+0.6*{Exam Score},1)|avg; Grade|text|=IF({Final Score}>=90,"A",IF({Final Score}>=80,"B",IF({Final Score}>=70,"C",IF({Final Score}>=60,"D","F"))))', 'Ananya, 88, 92, 95'),
  T('workout', 'Workout and Fitness Progress Log', 'Workout_Fitness_Log', ['workout and fitness progress log', 'fitness progress', 'workout log', 'fitness log', 'workout', 'fitness', 'gym log'],
    'Date|date; Exercise|text; Muscle Group|text; Sets|integer|sum; Reps|integer|none; Weight (kg)|number|none; Calories|integer|sum; Volume (kg)|number|={Sets}*{Reps}*{Weight (kg)}|sum', '2026-11-06, bench press, chest, 4, 10, 60, 2200'),
  T('wedding', 'Wedding Guest List and RSVP Tracker', 'Wedding_Guest_RSVP', ['wedding guest list and rsvp tracker', 'wedding guest list', 'guest list', 'rsvp tracker', 'rsvp', 'wedding'],
    'Guest|text; Side|text; Party Size|integer|sum; Meal Preference|text; RSVP|text; Table|integer|none; Gift Note|text', "Rohan Sharma, groom's side, 2, vegetarian, yes, 5, silver set"),
  T('travel', 'Travel Itinerary and Expense Planner', 'Travel_Itinerary_Expenses', ['travel itinerary and expense planner', 'travel itinerary', 'trip planner', 'travel planner', 'itinerary', 'travel expense', 'trip'],
    'Date|date; Destination|text; Flight or Hotel|text; Activity|text; Cost|number|sum; Exchange Rate|number|none; Cost (Home Currency)|money|={Cost}*{Exchange Rate}', '2026-12-20, Goa, 6E 245, beach day, 3000, 1'),
  T('rental', 'Rental Property Analyzer', 'Rental_Property_Analyzer', ['real estate rental property analyzer', 'rental property analyzer', 'rental property', 'real estate', 'property analyzer', 'rental analysis'],
    'Property|text; Purchase Price|money; Down Payment|money; Mortgage Rate|percent|none; Monthly Rent|money; Monthly Maintenance|money; Loan Amount|money|={Purchase Price}-{Down Payment}; Annual Net Income|money|=12*({Monthly Rent}-{Monthly Maintenance}); Cap Rate|percent|=IF({Purchase Price}=0,0,{Annual Net Income}/{Purchase Price})|avg', 'Flat 4B Pune, 6500000, 1500000, 8.5, 28000, 3000'),
  T('portfolio', 'Stock Portfolio and Dividend Tracker', 'Stock_Portfolio_Tracker', ['stock portfolio and dividend tracker', 'stock portfolio', 'dividend tracker', 'investment portfolio', 'portfolio tracker', 'portfolio', 'share portfolio'],
    'Ticker|text; Buy Date|date; Shares|number|sum; Cost per Share|money|none; Current Price|money|none; Dividend Yield|percent|avg; Invested|money|={Shares}*{Cost per Share}; Market Value|money|={Shares}*{Current Price}; Gain or Loss|money|={Market Value}-{Invested}; Annual Dividend|money|={Market Value}*{Dividend Yield}', 'INFY, 2025-03-14, 20, 1450, 1620, 2.4'),
  T('loan', 'EMI and Loan Amortization Schedule', 'Loan_Amortization_Schedule', ['emi and loan amortization schedule', 'loan amortization schedule', 'loan amortization', 'amortization schedule', 'amortization', 'emi schedule', 'emi calculator', 'loan schedule', 'emi'],
    'Month|integer|none; Payment Date|date; EMI|money; Interest|money; Principal|money; Prepayment|money; Balance|money|none', '500000, 9.5, 60', 'loan'),
  T('saas', 'Startup SaaS MRR and Churn Model', 'SaaS_MRR_Churn_Model', ['startup saas mrr and churn model', 'saas mrr', 'mrr and churn', 'churn model', 'saas model', 'saas', 'mrr'],
    'Month|text; Starting Subscribers|integer|none; New Subscribers|integer|sum; Churned|integer|sum; ARPU|money|none; Expansion Revenue|money; Ending Subscribers|integer|={Starting Subscribers}+{New Subscribers}-{Churned}|none; MRR|money|={Ending Subscribers}*{ARPU}+{Expansion Revenue}|none; Churn Rate|percent|=IF({Starting Subscribers}=0,0,{Churned}/{Starting Subscribers})|avg', 'January, 1000, 150, 40, 499, 20000'),
  T('pricing', 'E-commerce Product Pricing Calculator', 'Ecommerce_Pricing_Calculator', ['e-commerce product pricing calculator', 'ecommerce product pricing', 'e commerce product pricing', 'product pricing calculator', 'pricing calculator', 'product pricing', 'pricing'],
    'Product|text; Manufacturing Cost|money|none; Shipping Fee|money|none; Platform Commission|percent|none; Ad Cost per Sale|money|none; Target Margin|percent|none; Selling Price|money|=IFERROR(({Manufacturing Cost}+{Shipping Fee}+{Ad Cost per Sale})/(1-{Platform Commission}-{Target Margin}),0)|none; Profit per Sale|money|={Selling Price}*{Target Margin}|none', 'Steel bottle, 180, 40, 15, 60, 25'),
  T('foodcost', 'Restaurant Recipe Food Cost Sheet', 'Restaurant_Food_Cost_Sheet', ['restaurant recipe food cost sheet', 'recipe food cost', 'food cost sheet', 'food cost', 'recipe cost', 'restaurant'],
    'Ingredient|text; Purchase Cost|money|none; Purchase Weight (g)|number|none; Portion Used (g)|number|none; Waste|percent|none; Portion Cost|money|=IFERROR({Purchase Cost}/{Purchase Weight (g)}*{Portion Used (g)}/(1-{Waste}),0)', 'Paneer, 400, 1000, 150, 5'),
  T('editorial', 'Content Creator Editorial Calendar', 'Content_Editorial_Calendar', ['content creator editorial calendar', 'editorial calendar', 'content calendar', 'content creator', 'posting schedule', 'youtube schedule'],
    'Publish Date|date; Platform|text; Title|text; Sponsorship|text; View Target|integer|sum; Actual Views|integer|sum; Achieved|percent|=IF({View Target}=0,0,{Actual Views}/{View Target})|avg', '2026-11-15, YouTube, Budget laptop review, sponsored, 50000, 0'),
  T('qa', 'Software Bug and QA Test Case Log', 'QA_Bug_Test_Log', ['software bug and qa test case log', 'qa test case', 'test case log', 'bug tracker', 'bug log', 'test cases', 'qa log', 'bug and qa'],
    'Test ID|text; Module|text; Steps to Reproduce|text; Expected Result|text; Actual Result|text; Severity|text; Status|text|=IF({Expected Result}={Actual Result},"Pass","Fail")', 'TC-01, login, enter wrong password, error shown, error shown, low'),
  T('payroll', 'Company Payroll and Tax Deduction Sheet', 'Payroll_Tax_Deduction', ['company payroll and tax deduction sheet', 'payroll and tax deduction', 'company payroll', 'payroll', 'salary sheet', 'salary register'],
    'Employee ID|text; Basic Salary|money; HRA|money; Bonus|money; Provident Fund|money; Professional Tax|money; Gross Pay|money|={Basic Salary}+{HRA}+{Bonus}; Net Pay|money|={Gross Pay}-{Provident Fund}-{Professional Tax}', 'EMP-001, 40000, 16000, 5000, 4800, 200'),
  T('event', 'Event Sponsorship and Budget Sheet', 'Event_Budget_Sponsorship', ['event sponsorship and budget sheet', 'event sponsorship', 'event budget', 'sponsorship', 'event planner', 'event'],
    'Line Item|text; Category|text; Income|money; Cost|money; Net|money|={Income}-{Cost}', 'Gold sponsor, sponsorship, 200000, 0'),
  T('vehicle', 'Vehicle Fuel and Maintenance Log', 'Vehicle_Maintenance_Log', ['vehicle fuel and maintenance log', 'vehicle maintenance', 'fuel and maintenance', 'fuel log', 'mileage log', 'car maintenance', 'vehicle'],
    'Date|date; Odometer (km)|number|none; Fuel (litres)|number|sum; Price per Litre|money|none; Service or Parts|text; Service Cost|money; Fuel Cost|money|={Fuel (litres)}*{Price per Litre}; Total Cost|money|={Fuel Cost}+{Service Cost}', '2026-11-01, 24500, 35, 104, oil change, 1800'),
  T('literature', 'Academic Research Literature Matrix', 'Research_Literature_Matrix', ['academic research literature matrix', 'research literature matrix', 'literature matrix', 'literature review', 'research papers', 'literature'],
    'Paper Title|text; Authors|text; Year|integer|none; Methodology|text; Sample Size|integer|sum; Key Findings|text', 'Attention is all you need, Vaswani et al, 2017, experimental, 0, transformers beat RNNs'),
  T('habit', 'Daily Habit and Productivity Scorecard', 'Habit_Productivity_Scorecard', ['daily habit and productivity scorecard', 'habit and productivity', 'productivity scorecard', 'habit tracker', 'daily habit', 'habit scorecard', 'habits', 'habit'],
    'Habit|text; Target per Week|integer|sum; Done This Week|integer|sum; Streak (days)|integer|none; Score|percent|=IF({Target per Week}=0,0,{Done This Week}/{Target per Week})|avg', 'Morning run, 5, 4, 12'),
  T('medical', 'Medical Prescription and Vitals Log', 'Medical_Vitals_Log', ['medical prescription and vitals log', 'prescription and vitals', 'vitals log', 'medical log', 'medication log', 'health log', 'blood pressure log', 'medical'],
    'Date|date; Medication|text; Dosage|text; Blood Pressure|text; Glucose (mg/dL)|number|avg; Doctor Notes|text', '2026-11-06, Metformin, 500 mg twice daily, 120/80, 110, fasting reading'),
  T('construction', 'Construction Material Estimation Sheet', 'Construction_Material_Estimate', ['construction material estimation sheet', 'construction material', 'material estimation', 'material estimate', 'construction estimate', 'construction'],
    'Work Phase|text; Material|text; Unit|text; Quantity|number|none; Supplier Rate|money|none; Labor Cost|money; Material Cost|money|={Quantity}*{Supplier Rate}; Total Cost|money|={Material Cost}+{Labor Cost}', 'Foundation, cement, bag, 120, 380, 15000'),
  T('marketing', 'Digital Marketing Ad Campaign ROI Sheet', 'Marketing_Campaign_ROI', ['digital marketing ad campaign roi sheet', 'ad campaign roi', 'campaign roi', 'marketing roi', 'ad campaign', 'digital marketing', 'marketing campaign', 'roas'],
    'Campaign|text; Platform|text; Spend|money; Impressions|integer|sum; Clicks|integer|sum; Conversions|integer|sum; Revenue|money; CTR|percent|=IF({Impressions}=0,0,{Clicks}/{Impressions})|avg; CPC|money|=IF({Clicks}=0,0,{Spend}/{Clicks})|avg; ROAS|number|=IF({Spend}=0,0,{Revenue}/{Spend})|avg', 'Diwali sale, Instagram, 20000, 150000, 4200, 180, 96000'),
  T('vendor', 'Vendor Comparison and Procurement Matrix', 'Vendor_Comparison_Matrix', ['vendor comparison and procurement matrix', 'vendor comparison', 'procurement matrix', 'vendor matrix', 'compare vendors', 'vendor'],
    'Vendor|text; Quoted Price|money|none; Lead Time (days)|integer|none; Warranty (months)|integer|none; Quality (1-10)|number|avg; Score|number|=ROUND({Quality (1-10)}*10-{Lead Time (days)}*0.5+{Warranty (months)}*0.5,1)|none', 'Sharma Traders, 85000, 14, 12, 8'),
  T('tax', 'Annual Tax Deduction and Receipt Organizer', 'Annual_Tax_Receipt_Organizer', ['annual tax deduction and receipt organizer', 'tax deduction and receipt', 'receipt organizer', 'tax receipts', 'tax deductions', 'tax deduction', 'tax organizer', 'receipts'],
    'Receipt Date|date; Vendor|text; Tax Category|text; Payment Mode|text; Amount|money; Deductible Amount|money', '2026-04-12, LIC, 80C, UPI, 25000, 25000'),
];

export const SHEET_BY_ID = new Map(SHEET_TEMPLATES.map((t) => [t.id, t]));

/** Best template for a phrase ("build a custom monthly personal budget in Excel…"), by longest matching key. */
export function findSheetTemplate(text: string): SheetTemplate | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let best: { tpl: SheetTemplate; len: number } | null = null;
  for (const tpl of SHEET_TEMPLATES) {
    for (const k of tpl.keys) {
      const key = ` ${k.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
      if (t.includes(key) && (!best || key.length > best.len)) best = { tpl, len: key.length };
    }
  }
  return best?.tpl ?? null;
}

/** Monthly EMI schedule rows (Month, Payment Date, EMI, Interest, Principal, Prepayment, Balance). */
export function amortizationRows(principal: number, annualRatePct: number, months: number, start = new Date(), prepayment = 0): Array<Array<string | number>> {
  const r = annualRatePct / 1200;
  const emi = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  const rows: Array<Array<string | number>> = [];
  let balance = principal;
  for (let m = 1; m <= months && balance > 0.005; m++) {
    const interest = balance * r;
    const princ = Math.min(balance, emi - interest);
    const extra = Math.min(balance - princ, prepayment);
    balance = balance - princ - extra;
    const d = new Date(start.getFullYear(), start.getMonth() + m, Math.min(start.getDate(), 28));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push([m, iso, +emi.toFixed(2), +interest.toFixed(2), +princ.toFixed(2), +extra.toFixed(2), +Math.max(0, balance).toFixed(2)]);
  }
  return rows;
}
