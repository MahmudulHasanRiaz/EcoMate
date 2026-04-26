type ScenarioResult = {
  name: string;
  expectedPrice: number;
  expectedSiteDiscount: number;
  actualPrice: number;
  actualSiteDiscount: number;
};

function computeComboLine(
  comboUnitPrice: number,
  quantity: number,
  wooLineTotal: number,
  fallbackWooUnitPrice: number
) {
  const comboGross = comboUnitPrice * quantity;
  if (comboGross >= wooLineTotal) {
    return {
      effectivePrice: comboUnitPrice,
      siteDiscount: comboGross - wooLineTotal,
    };
  }
  return {
    effectivePrice: fallbackWooUnitPrice,
    siteDiscount: 0,
  };
}

function computeNonComboLine(
  resolvedEffectivePrice: number,
  wooUnitPrice: number,
  quantity: number
) {
  const diff = Math.max(resolvedEffectivePrice - wooUnitPrice, 0);
  return {
    effectivePrice: resolvedEffectivePrice,
    siteDiscount: diff * quantity,
  };
}

function runScenarios(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  // Scenario 1: Combo item.
  // combo unit total: 500, qty: 2, woo total: 800
  // gross: 1000 -> discount: 200
  {
    const actual = computeComboLine(500, 2, 800, 400);
    results.push({
      name: "Scenario 1: Combo Item",
      expectedPrice: 500,
      expectedSiteDiscount: 200,
      actualPrice: actual.effectivePrice,
      actualSiteDiscount: actual.siteDiscount,
    });
  }

  // Scenario 2: Non-combo sale exactly matches woo line.
  {
    const actual = computeNonComboLine(800, 800, 1);
    results.push({
      name: "Scenario 2: Non-Combo (Sale)",
      expectedPrice: 800,
      expectedSiteDiscount: 0,
      actualPrice: actual.effectivePrice,
      actualSiteDiscount: actual.siteDiscount,
    });
  }

  // Scenario 3: Non-combo with site discount.
  // effective: 1000, woo: 900, qty: 1 -> discount: 100
  {
    const actual = computeNonComboLine(1000, 900, 1);
    results.push({
      name: "Scenario 3: Non-Combo (Site Discount)",
      expectedPrice: 1000,
      expectedSiteDiscount: 100,
      actualPrice: actual.effectivePrice,
      actualSiteDiscount: actual.siteDiscount,
    });
  }

  return results;
}

function printReport(results: ScenarioResult[]) {
  console.log("--- Testing Pricing Logic ---");
  for (const result of results) {
    console.log(result.name);
    console.log(
      `Expected: EffectivePrice=${result.expectedPrice}, SiteDiscount=${result.expectedSiteDiscount}`
    );
    console.log(
      `Actual:   EffectivePrice=${result.actualPrice}, SiteDiscount=${result.actualSiteDiscount}`
    );
  }
}

function assertResults(results: ScenarioResult[]) {
  for (const result of results) {
    const priceOk = result.actualPrice === result.expectedPrice;
    const discountOk = result.actualSiteDiscount === result.expectedSiteDiscount;
    if (!priceOk || !discountOk) {
      throw new Error(
        `${result.name} failed. expected (${result.expectedPrice}, ${result.expectedSiteDiscount}) got (${result.actualPrice}, ${result.actualSiteDiscount})`
      );
    }
  }
}

const results = runScenarios();
printReport(results);
assertResults(results);
