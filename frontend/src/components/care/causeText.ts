/** Wording for the likely contributors to hypos and highs (EN/FR), with the evidence spelled out. */

export type Cause = { code: string; weight: number; params: Record<string, any> };

const MEAL = {
  en: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', resucrage: 'Hypo snack', other: 'Meal' } as Record<string, string>,
  fr: { breakfast: 'Petit-déjeuner', lunch: 'Déjeuner', dinner: 'Dîner', snack: 'Collation', resucrage: 'Resucrage', other: 'Repas' } as Record<string, string>,
};

const meal = (lang: 'en' | 'fr', t?: string) => MEAL[lang][t || 'other'] || MEAL[lang].other;

const en = {
  likely: 'Likely',
  foundTitle: 'Patterns spotted in your history',
  foundLede: (days: number, withData: number) =>
    `Checked automatically over the last ${days} days (${withData} days with sensor data). Only clear, repeated patterns are shown.`,
  foundNone: 'No clear pattern stands out yet. More logged days (meals, insulin, sport) make patterns easier to spot.',
  found(p: FoundPattern): string {
    const q = p.params;
    switch (p.code) {
      case 'sportNightHypo':
        return `Nights after sport: a hypo on ${q.hits} of ${q.nights} nights, against ${q.otherHits} of ${q.otherNights} other nights.`;
      case 'hypoAfterSport':
        return `${q.hits} of ${q.sessions} sport sessions were followed by a hypo within 4 h.`;
      case 'lateBolusHigh':
        return `Meals bolused late went high ${pct(q.hits, q.meals)} of the time (${q.hits} of ${q.meals}), against ${pct(q.onTimeHits, q.onTimeMeals)} when bolused on time.`;
      case 'missedBolusHigh':
        return `Meals without a bolus went high ${pct(q.hits, q.meals)} of the time (${q.hits} of ${q.meals}), against ${pct(q.onTimeHits, q.onTimeMeals)} when bolused on time.`;
      case 'mealSpike':
        return `${meal('en', q.mealType)} rises the most: about +${q.riseMgDl} mg/dL in the 3 h after eating, against +${q.otherRiseMgDl} for other meals (${q.meals} meals).`;
      case 'hypoTimeCluster':
        return `${q.hits} of ${q.episodes} hypos start between ${hh(q.fromHour)} and ${hh(q.toHour)}.`;
      case 'highTimeCluster':
        return `${q.hits} of ${q.episodes} highs start between ${hh(q.fromHour)} and ${hh(q.toHour)}.`;
      case 'dawnRise':
        return `Glucose rises by 30 mg/dL or more between 3 and 8 am without food on ${q.days} of ${q.of} mornings (dawn phenomenon).`;
      case 'reboundAfterHypo':
        return `${q.hits} of ${q.hypos} hypos were followed by a high within 3 h: the treatment may be more sugar than needed.`;
      case 'weekendDiff':
        return `Weekends: ${q.tir}% in range, average ${q.avgMgDl}, against ${q.otherTir}% and ${q.otherAvgMgDl} on weekdays.`;
      case 'stressDayDiff':
        return `High-stress days: ${q.tir}% in range, average ${q.avgMgDl}, against ${q.otherTir}% and ${q.otherAvgMgDl} on other days.`;
      case 'sportDayDiff':
        return `Sport days: ${q.tir}% in range, average ${q.avgMgDl}, against ${q.otherTir}% and ${q.otherAvgMgDl} on other days.`;
      case 'activeDayDiff':
        return `Days with 10,000+ steps: ${q.tir}% in range, average ${q.avgMgDl}, against ${q.otherTir}% and ${q.otherAvgMgDl} on other days.`;
      default:
        return p.code;
    }
  },
  also: 'Also',
  contributors: 'Likely contributors',
  context: 'Context',
  caveat: 'Worked out from what was logged (meals, insulin, sport, pump alerts). For discussion with the care team, not a diagnosis.',
  highsTitle: 'Highs',
  highsSummary: (n: number, target: number) =>
    n ? `${n} episodes above ${Math.round(target)} mg/dL for an hour or more` : 'No sustained highs in this period.',
  peak: 'Peak',
  patternsTitle: 'What’s behind the lows and highs',
  hypoPatterns: 'Behind the hypos',
  highPatterns: 'Behind the highs',
  noPatterns: 'Nothing to show for this period.',
  ofEpisodes: (n: number, of: number) => `${n} of ${of}`,
  bolusTitle: 'Meal bolus timing',
  bolusLine: (b: BolusTiming) =>
    b.mealsChecked
      ? `${b.mealsChecked} meals with carbs · ${b.onTime} bolused on time · ${b.late} late${b.avgLateMin != null ? ` (on average ${b.avgLateMin} min after eating)` : ''} · ${b.missed} without a bolus`
      : 'No meals with a matching bolus to check.',
  ratioLine: (r: number) => `Usual carb ratio from logged meals: about 1 U per ${r} g.`,
  cause(c: Cause): string {
    const p = c.params;
    switch (c.code) {
      case 'sportRecent':
        return `${cap(p.sport)} (${p.durationMin} min) ended ${p.hoursBefore} h before`;
      case 'sportDelayed':
        return `${cap(p.sport)} (${p.durationMin} min) ${p.hoursBefore} h before: delayed effect of exercise`;
      case 'sportSameDay':
        return `${cap(p.sport)} (${p.durationMin} min) earlier that day`;
      case 'sportDayBefore':
        return `${cap(p.sport)} (${p.durationMin} min) the day before: delayed effect of exercise`;
      case 'activeDay':
        return `Very active day: ${fmt(p.steps)} steps (usually ${fmt(p.usualSteps)})`;
      case 'insulinStacking':
        return `${p.count} boluses (${p.units} U) within ${p.withinMin} min: insulin stacking`;
      case 'overcorrection':
        return `Correction of ${p.units} U after a high of ${p.peakMgDl}, ${p.minutesBefore} min before: overcorrection`;
      case 'bolusNoMeal':
        return `Bolus of ${p.units} U with no meal logged, ${p.minutesBefore} min before`;
      case 'doseAboveRatio':
        return `${p.units} U for ${p.carbs} g carbs (usual ratio gives about ${p.expectedUnits} U)`;
      case 'longFast':
        return `No food logged for ${p.hoursSinceMeal} h`;
      case 'fastFall':
        return `Fast drop (${p.ratePerMin} mg/dL per min)`;
      case 'sensorCheck':
        return p.sensorAlert
          ? 'Sensor alert around then: the reading may be off'
          : 'Short overnight low: possibly a compression low (lying on the sensor)';
      case 'noLoggedCauseHypo':
        return 'No logged cause. To check: unlogged activity, a missed or smaller meal, alcohol, heat or a hot shower';
      case 'lateBolus':
        return `${meal('en', p.mealType)} (${p.carbs} g) bolused ${p.minutesLate} min after eating`;
      case 'missedBolus':
        return `${meal('en', p.mealType)} (${p.carbs} g) with no bolus`;
      case 'doseBelowRatio':
        return `${p.units} U for ${meal('en', p.mealType).toLowerCase()} ${p.carbs} g (usual ratio gives about ${p.expectedUnits} U)`;
      case 'largeMeal':
        return `Large ${meal('en', p.mealType).toLowerCase()}: ${p.carbs} g carbs`;
      case 'pumpAlert':
        return p.minutesBefore >= 0
          ? `Pump alert: ${p.title} ${p.minutesBefore} min before`
          : `Pump alert during the high: ${p.title}`;
      case 'reboundAfterHypo':
        return `Rebound after a low of ${p.lowMgDl}, ${p.minutesAfter} min earlier (more sugar than needed?)`;
      case 'dawn':
        return 'Early-morning rise with no food: dawn phenomenon';
      case 'oldInfusionSet':
        return `Infusion set ${p.days} days old`;
      case 'stress':
        return 'High stress logged that day';
      case 'noRecentInsulin':
        return p.hoursSince != null ? `No bolus for ${p.hoursSince} h` : 'No bolus logged before it';
      case 'noLoggedCauseHigh':
        return 'No logged cause. To check: an unlogged snack, illness, the infusion site or cannula, insulin left in the heat';
      default:
        return c.code;
    }
  },
  pattern: {
    sportRecent: 'Sport in the 4 h before',
    sportDelayed: 'Sport 4–24 h before (delayed effect)',
    sportSameDay: 'Sport earlier that day',
    sportDayBefore: 'Sport the day before',
    activeDay: 'Very active day',
    insulinStacking: 'Insulin stacking',
    overcorrection: 'Overcorrection of a high',
    bolusNoMeal: 'Bolus without a meal',
    doseAboveRatio: 'More insulin than usual for the carbs',
    longFast: 'Long gap without food',
    fastFall: 'Fast drop',
    sensorCheck: 'Possible sensor issue',
    noLoggedCauseHypo: 'No logged cause',
    lateBolus: 'Late meal bolus',
    missedBolus: 'Meal without bolus',
    doseBelowRatio: 'Less insulin than usual for the carbs',
    largeMeal: 'Large meal',
    pumpAlert: 'Pump alert',
    reboundAfterHypo: 'Rebound after a hypo',
    dawn: 'Dawn phenomenon',
    oldInfusionSet: 'Old infusion set',
    stress: 'High stress',
    noRecentInsulin: 'No recent bolus',
    noLoggedCauseHigh: 'No logged cause',
  } as Record<string, string>,
};

export type FoundPattern = { code: string; strength: number; params: Record<string, any> };

export type BolusTiming = { mealsChecked: number; onTime: number; late: number; missed: number; avgLateMin: number | null };

const fr: typeof en = {
  likely: 'Probable',
  foundTitle: 'Tendances repérées dans votre historique',
  foundLede: (days, withData) =>
    `Analyse automatique des ${days} derniers jours (${withData} jours avec capteur). Seules les tendances nettes et répétées sont affichées.`,
  foundNone: 'Aucune tendance nette pour l’instant. Plus de jours renseignés (repas, insuline, sport) aident à les repérer.',
  found(p) {
    const q = p.params;
    switch (p.code) {
      case 'sportNightHypo':
        return `Nuits après le sport : hypo ${q.hits} nuits sur ${q.nights}, contre ${q.otherHits} sur ${q.otherNights} les autres nuits.`;
      case 'hypoAfterSport':
        return `${q.hits} séances de sport sur ${q.sessions} ont été suivies d’une hypo dans les 4 h.`;
      case 'lateBolusHigh':
        return `Repas avec bolus en retard : hyper ${pct(q.hits, q.meals)} du temps (${q.hits} sur ${q.meals}), contre ${pct(q.onTimeHits, q.onTimeMeals)} avec un bolus à l’heure.`;
      case 'missedBolusHigh':
        return `Repas sans bolus : hyper ${pct(q.hits, q.meals)} du temps (${q.hits} sur ${q.meals}), contre ${pct(q.onTimeHits, q.onTimeMeals)} avec un bolus à l’heure.`;
      case 'mealSpike':
        return `${meal('fr', q.mealType)} fait le plus monter : environ +${q.riseMgDl} mg/dL dans les 3 h, contre +${q.otherRiseMgDl} pour les autres repas (${q.meals} repas).`;
      case 'hypoTimeCluster':
        return `${q.hits} hypos sur ${q.episodes} commencent entre ${hh(q.fromHour)} et ${hh(q.toHour)}.`;
      case 'highTimeCluster':
        return `${q.hits} hypers sur ${q.episodes} commencent entre ${hh(q.fromHour)} et ${hh(q.toHour)}.`;
      case 'dawnRise':
        return `La glycémie monte de 30 mg/dL ou plus entre 3 h et 8 h sans manger ${q.days} matins sur ${q.of} (phénomène de l’aube).`;
      case 'reboundAfterHypo':
        return `${q.hits} hypos sur ${q.hypos} ont été suivies d’une hyper dans les 3 h : le resucrage est peut-être trop important.`;
      case 'weekendDiff':
        return `Week-ends : ${q.tir} % dans la cible, moyenne ${q.avgMgDl}, contre ${q.otherTir} % et ${q.otherAvgMgDl} en semaine.`;
      case 'stressDayDiff':
        return `Jours de stress élevé : ${q.tir} % dans la cible, moyenne ${q.avgMgDl}, contre ${q.otherTir} % et ${q.otherAvgMgDl} les autres jours.`;
      case 'sportDayDiff':
        return `Jours de sport : ${q.tir} % dans la cible, moyenne ${q.avgMgDl}, contre ${q.otherTir} % et ${q.otherAvgMgDl} les autres jours.`;
      case 'activeDayDiff':
        return `Jours à plus de 10 000 pas : ${q.tir} % dans la cible, moyenne ${q.avgMgDl}, contre ${q.otherTir} % et ${q.otherAvgMgDl} les autres jours.`;
      default:
        return p.code;
    }
  },
  also: 'Aussi',
  contributors: 'Causes probables',
  context: 'Contexte',
  caveat: 'Déduit de ce qui a été enregistré (repas, insuline, sport, alertes pompe). Pour en discuter avec l’équipe soignante, pas un diagnostic.',
  highsTitle: 'Hyperglycémies',
  highsSummary: (n, target) =>
    n ? `${n} épisodes au-dessus de ${Math.round(target)} mg/dL pendant une heure ou plus` : 'Aucune hyper prolongée sur la période.',
  peak: 'Pic',
  patternsTitle: 'Ce qui explique les hypos et les hypers',
  hypoPatterns: 'Derrière les hypos',
  highPatterns: 'Derrière les hypers',
  noPatterns: 'Rien à signaler sur la période.',
  ofEpisodes: (n, of) => `${n} sur ${of}`,
  bolusTitle: 'Horaire des bolus de repas',
  bolusLine: (b) =>
    b.mealsChecked
      ? `${b.mealsChecked} repas avec glucides · ${b.onTime} bolus à l’heure · ${b.late} en retard${b.avgLateMin != null ? ` (en moyenne ${b.avgLateMin} min après le repas)` : ''} · ${b.missed} sans bolus`
      : 'Aucun repas avec bolus à analyser.',
  ratioLine: (r) => `Ratio glucidique habituel d’après les repas : environ 1 U pour ${r} g.`,
  cause(c) {
    const p = c.params;
    switch (c.code) {
      case 'sportRecent':
        return `${cap(p.sport)} (${p.durationMin} min) terminé ${p.hoursBefore} h avant`;
      case 'sportDelayed':
        return `${cap(p.sport)} (${p.durationMin} min) ${p.hoursBefore} h avant : effet retardé de l’effort`;
      case 'sportSameDay':
        return `${cap(p.sport)} (${p.durationMin} min) plus tôt dans la journée`;
      case 'sportDayBefore':
        return `${cap(p.sport)} (${p.durationMin} min) la veille : effet retardé de l’effort`;
      case 'activeDay':
        return `Journée très active : ${fmt(p.steps)} pas (habituellement ${fmt(p.usualSteps)})`;
      case 'insulinStacking':
        return `${p.count} bolus (${p.units} U) en ${p.withinMin} min : accumulation d’insuline`;
      case 'overcorrection':
        return `Correction de ${p.units} U après une hyper à ${p.peakMgDl}, ${p.minutesBefore} min avant : surcorrection`;
      case 'bolusNoMeal':
        return `Bolus de ${p.units} U sans repas enregistré, ${p.minutesBefore} min avant`;
      case 'doseAboveRatio':
        return `${p.units} U pour ${p.carbs} g de glucides (le ratio habituel donne environ ${p.expectedUnits} U)`;
      case 'longFast':
        return `Aucun repas enregistré depuis ${p.hoursSinceMeal} h`;
      case 'fastFall':
        return `Chute rapide (${p.ratePerMin} mg/dL par min)`;
      case 'sensorCheck':
        return p.sensorAlert
          ? 'Alerte capteur au même moment : la mesure peut être fausse'
          : 'Hypo nocturne courte : peut-être une fausse hypo de compression (appui sur le capteur)';
      case 'noLoggedCauseHypo':
        return 'Aucune cause enregistrée. À vérifier : activité non notée, repas sauté ou plus petit, alcool, chaleur ou douche chaude';
      case 'lateBolus':
        return `${meal('fr', p.mealType)} (${p.carbs} g) : bolus ${p.minutesLate} min après le repas`;
      case 'missedBolus':
        return `${meal('fr', p.mealType)} (${p.carbs} g) sans bolus`;
      case 'doseBelowRatio':
        return `${p.units} U pour ${meal('fr', p.mealType).toLowerCase()} ${p.carbs} g (le ratio habituel donne environ ${p.expectedUnits} U)`;
      case 'largeMeal':
        return `${meal('fr', p.mealType)} copieux : ${p.carbs} g de glucides`;
      case 'pumpAlert':
        return p.minutesBefore >= 0
          ? `Alerte pompe : ${p.title} ${p.minutesBefore} min avant`
          : `Alerte pompe pendant l’hyper : ${p.title}`;
      case 'reboundAfterHypo':
        return `Rebond après une hypo à ${p.lowMgDl}, ${p.minutesAfter} min plus tôt (trop de sucre pour se resucrer ?)`;
      case 'dawn':
        return 'Hausse en début de matinée sans repas : phénomène de l’aube';
      case 'oldInfusionSet':
        return `Cathéter posé depuis ${p.days} jours`;
      case 'stress':
        return 'Stress élevé noté ce jour-là';
      case 'noRecentInsulin':
        return p.hoursSince != null ? `Aucun bolus depuis ${p.hoursSince} h` : 'Aucun bolus enregistré avant';
      case 'noLoggedCauseHigh':
        return 'Aucune cause enregistrée. À vérifier : collation non notée, maladie, site ou cathéter, insuline exposée à la chaleur';
      default:
        return c.code;
    }
  },
  pattern: {
    sportRecent: 'Sport dans les 4 h avant',
    sportDelayed: 'Sport 4 à 24 h avant (effet retardé)',
    sportSameDay: 'Sport plus tôt dans la journée',
    sportDayBefore: 'Sport la veille',
    activeDay: 'Journée très active',
    insulinStacking: 'Accumulation d’insuline',
    overcorrection: 'Surcorrection d’une hyper',
    bolusNoMeal: 'Bolus sans repas',
    doseAboveRatio: 'Plus d’insuline que d’habitude pour les glucides',
    longFast: 'Longue période sans manger',
    fastFall: 'Chute rapide',
    sensorCheck: 'Problème de capteur possible',
    noLoggedCauseHypo: 'Aucune cause enregistrée',
    lateBolus: 'Bolus de repas en retard',
    missedBolus: 'Repas sans bolus',
    doseBelowRatio: 'Moins d’insuline que d’habitude pour les glucides',
    largeMeal: 'Repas copieux',
    pumpAlert: 'Alerte pompe',
    reboundAfterHypo: 'Rebond après une hypo',
    dawn: 'Phénomène de l’aube',
    oldInfusionSet: 'Cathéter ancien',
    stress: 'Stress élevé',
    noRecentInsulin: 'Pas de bolus récent',
    noLoggedCauseHigh: 'Aucune cause enregistrée',
  },
};

function pct(hits: number, n: number) {
  return n ? `${Math.round((hits / n) * 100)}%` : '—';
}

function hh(h: number) {
  return `${String(h % 24).padStart(2, '0')}:00`;
}

function cap(s?: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function fmt(n?: number) {
  return n == null ? '—' : Math.round(n).toLocaleString('fr-FR');
}

export type CauseText = typeof en;

export function causeText(locale: string): CauseText {
  return locale === 'fr' ? fr : en;
}
