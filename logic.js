(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const exports = factory();
    Object.assign(root, exports);
    root.logic = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COUPON_PER_PUZZLE = 500;
  const PUZZLES_PER_LEVEL = 5;
  const MAX_LEVEL = 180;
  const STAR_COSTS = [500, 1000, 6500, 25000, 65000];
  const STAR_ITEM_VALUES = {
    legendaryStars1: 110,
    legendaryStars2: 420,
    legendaryStars3: 960,
  };
  const STOCK_ZERO = {
    coupons: 0,
    puzzles: 0,
    starCoupons: 0,
    legendaryStars1: 0,
    legendaryStars2: 0,
    legendaryStars3: 0,
    chests: 0,
  };
  const INVESTED_ZERO = Object.freeze({
    starCoupons: 0,
    legendaryStars1: 0,
    legendaryStars2: 0,
    legendaryStars3: 0,
    levelCoupons: 0,
    levelPuzzles: 0,
    skillCoupons: 0,
    skillPuzzles: 0,
    coupons: 0,
    puzzles: 0,
  });

  function normalizeInvested(inv) {
    if (!inv || typeof inv !== 'object') {
      return { ...INVESTED_ZERO };
    }
    const starCoupons = Math.max(0, Math.round(Number(inv.starCoupons) || 0));
    const legendaryStars1 = Math.max(0, Math.round(Number(inv.legendaryStars1) || 0));
    const legendaryStars2 = Math.max(0, Math.round(Number(inv.legendaryStars2) || 0));
    const legendaryStars3 = Math.max(0, Math.round(Number(inv.legendaryStars3) || 0));

    let levelCoupons = Math.max(0, Math.round(Number(inv.levelCoupons) || 0));
    let levelPuzzles = Math.max(0, Math.round(Number(inv.levelPuzzles) || 0));
    let skillCoupons = Math.max(0, Math.round(Number(inv.skillCoupons) || 0));
    let skillPuzzles = Math.max(0, Math.round(Number(inv.skillPuzzles) || 0));

    const legacyCoupons = Math.max(0, Math.round(Number(inv.coupons) || 0));
    const legacyPuzzles = Math.max(0, Math.round(Number(inv.puzzles) || 0));

    if (levelCoupons === 0 && skillCoupons === 0 && legacyCoupons > 0) {
      levelCoupons = legacyCoupons;
    }
    if (levelPuzzles === 0 && skillPuzzles === 0 && legacyPuzzles > 0) {
      skillPuzzles = legacyPuzzles;
    }

    const totalCoupons = levelCoupons + skillCoupons;
    const totalPuzzles = levelPuzzles + skillPuzzles;

    return {
      starCoupons,
      legendaryStars1,
      legendaryStars2,
      legendaryStars3,
      levelCoupons,
      levelPuzzles,
      skillCoupons,
      skillPuzzles,
      coupons: totalCoupons,
      puzzles: totalPuzzles,
    };
  }

  const OFFICER_TYPES = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

  const DEFAULT_OFFICERS = [
    { id: 'admiral-nathon', name: 'Адмирал Нейтон', type: 'Пехота', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'general-rex', name: 'Генерал Рекс', type: 'Танк', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'captain-black', name: 'Капитан Блэк', type: 'ПТ-Сау', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
  ];

  const COMMUNITY_OFFICERS = [
    { id: 'admiral-nathon', name: 'Адмирал Нейтон', type: 'Пехота', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'general-rex', name: 'Генерал Рекс', type: 'Танк', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'captain-black', name: 'Капитан Блэк', type: 'ПТ-Сау', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'aurora', name: 'Аврора', type: 'Горнизон', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'valkyrie', name: 'Валькирия', type: 'Осада', generation: 9, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'angel', name: 'Ангел', type: 'Танк', generation: 2, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'halina', name: 'Халина', type: 'ПТ-Сау', generation: 2, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'betty', name: 'Бетти', type: 'Пехота', generation: 3, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'eva', name: 'Ева', type: 'Танк', generation: 2, couponPerPuzzle: 500, starCouponCost: 250, upgradeType: 'standard', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'grace', name: 'Грейс', type: 'Танк', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'jessica', name: 'Джессика', type: 'Танк', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
    { id: 'marjorie', name: 'Марджори', type: 'Пехота', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 690, medalsTraining: 900, medalsTotal: 1590 },
  ];

  const VIP_TIERS_DATA = [
    { level: 1, points: 0, dailyPuzzles: 0 },
    { level: 2, points: 200, dailyPuzzles: 0 },
    { level: 3, points: 700, dailyPuzzles: 0 },
    { level: 4, points: 2500, dailyPuzzles: 0 },
    { level: 5, points: 6000, dailyPuzzles: 0 },
    { level: 6, points: 15000, dailyPuzzles: 0 },
    { level: 7, points: 35000, dailyPuzzles: 0 },
    { level: 8, points: 75000, dailyPuzzles: 0 },
    { level: 9, points: 130000, dailyPuzzles: 0 },
    { level: 10, points: 220000, dailyPuzzles: 0 },
    { level: 11, points: 340000, dailyPuzzles: 1 },
    { level: 12, points: 480000, dailyPuzzles: 2 },
    { level: 13, points: 600000, dailyPuzzles: 2 },
    { level: 14, points: 750000, dailyPuzzles: 3 },
    { level: 15, points: 1000000, dailyPuzzles: 3 },
    { level: 16, points: 1300000, dailyPuzzles: 4 },
    { level: 17, points: 1700000, dailyPuzzles: 4 },
  ];

  const SKILL_UPGRADE_COSTS = [
    [10, 20, 30, 40], // Навык 1: 100 медалей
    [20, 40, 60, 80], // Навык 2: 200 медалей
    [30, 50, 70, 90], // Навык 3: 240 медалей
    [10, 30, 50, 60], // Навык 4: 150 медалей
  ];

  const SKILL_PROGRESSION_COSTS = [
    10, 10, 15, 15, 30, 30, 40, 40, 45, 45, 50, 50, 75, 75, 80, 80
  ];

  const STAR_CUMULATIVE_COSTS = [0, 500, 1500, 8000, 33000, 98000];

  const OFFICER_PAIRINGS = {
    'general-rex': [
      { partnerId: 'angel', partnerName: 'Ангел', role: 'Открытое поле', synergy: 'Максимальный танковый урон и выживаемость' },
      { partnerId: 'eva', partnerName: 'Ева', role: 'Ралли', synergy: 'Пробитие брони и высокая контратака' },
    ],
    'admiral-nathon': [
      { partnerId: 'betty', partnerName: 'Бетти', role: 'Открытое поле', synergy: 'Пехотная контратака и щиты' },
      { partnerId: 'marjorie', partnerName: 'Марджори', role: 'Оборона', synergy: 'Снижение входящего урона в гарнизоне' },
    ],
    'captain-black': [
      { partnerId: 'halina', partnerName: 'Халина', role: 'Открытое поле', synergy: 'Смертоносный залповый урон противотанковых орудий' },
    ],
    'aurora': [
      { partnerId: 'marjorie', partnerName: 'Марджори', role: 'Оборона', synergy: 'Неприступная оборона гарнизона' },
      { partnerId: 'admiral-nathon', partnerName: 'Адмирал Нейтон', role: 'Гарнизон', synergy: 'Высокое сопротивление урону пехоты' },
    ],
    'valkyrie': [
      { partnerId: 'captain-black', partnerName: 'Капитан Блэк', role: 'Осада', synergy: 'Разрушительный урон по вражеским укреплениям' },
    ],
    'angel': [
      { partnerId: 'general-rex', partnerName: 'Генерал Рекс', role: 'Открытое поле', synergy: 'Танковая мощь и контроль поля боя' },
    ],
    'halina': [
      { partnerId: 'captain-black', partnerName: 'Капитан Блэк', role: 'Открытое поле', synergy: 'ПТ-пробитие и взрывной урон' },
    ],
    'betty': [
      { partnerId: 'admiral-nathon', partnerName: 'Адмирал Нейтон', role: 'Открытое поле', synergy: 'Устойчивость пехоты и непрерывный урон' },
    ],
    'eva': [
      { partnerId: 'general-rex', partnerName: 'Генерал Рекс', role: 'Ралли', synergy: 'Танковое ралли и сокрушительная атака' },
    ],
    'grace': [
      { partnerId: 'general-rex', partnerName: 'Генерал Рекс', role: 'Открытое поле', synergy: 'Быстрый старт и ярость в танковых баталиях' },
    ],
    'jessica': [
      { partnerId: 'angel', partnerName: 'Ангел', role: 'Открытое поле', synergy: 'Высокая живучесть и поддержка союзников' },
    ],
    'marjorie': [
      { partnerId: 'aurora', partnerName: 'Аврора', role: 'Оборона', synergy: 'Усиленный гарнизон и восстановление прочности' },
    ],
  };

  const EVENT_PRESETS = [
    {
      id: 'king-of-war',
      name: 'Король Войны',
      color: '#8b5cf6',
      startDayOfWeek: 2, // Вторник
      durationDays: 2,   // Вт - Ср
      activeWeeks: 1,
      breakWeeks: 1,
      weekOffset: 0,
      description: 'Король Войны (набрать силу сектора): 2 дня (Вт–Ср), через неделю',
    },
    {
      id: 'mighty-forces',
      name: 'Мощные Силы',
      color: '#10b981',
      startDayOfWeek: 6, // Суббота
      durationDays: 3,   // Сб - Пн
      activeWeeks: 1,
      breakWeeks: 1,
      weekOffset: 0,
      description: 'Мощные Силы (производство войск): 3 дня (Сб–Пн), через неделю',
    },
    {
      id: 'power-of-time',
      name: 'Сила Времени',
      color: '#f59e0b',
      startDayOfWeek: 2, // Вторник
      durationDays: 3,   // Вт - Чт
      activeWeeks: 1,
      breakWeeks: 1,
      weekOffset: 1,     // Чередуется с Королем Войны
      description: 'Сила Времени (трата ускорителей): 3 дня (Вт–Чт), чередуется с Королем Войны',
    },
  ];

  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-zа-я0-9]+/gi, '-')
      .replace(/^-|-$/g, '') || `officer-${Date.now()}`;
  }

  function uniqueCatalog(baseCatalog, players) {
    const catalog = [...(Array.isArray(baseCatalog) && baseCatalog.length ? baseCatalog : DEFAULT_OFFICERS)];
    const byName = new Map(catalog.map(o => [o.name.toLowerCase(), o]));

    players.forEach(player => {
      (player.officers || []).forEach(officer => {
        if (!officer.name) return;
        const key = officer.name.toLowerCase();
        if (!byName.has(key)) {
          const item = { ...DEFAULT_OFFICERS[0], id: slug(officer.name), name: officer.name, generation: 7 };
          catalog.push(item);
          byName.set(key, item);
        }
      });
    });

    return catalog;
  }

  function normalizeSector(sector) {
    return {
      vipLevel: Number(sector?.vipLevel) || 0,
      confidentialityLevel: Number(sector?.confidentialityLevel) || 0,
      power: Number(sector?.power) || 0,
      kills: Number(sector?.kills) || 0,
      killPoints: Math.round((Number(sector?.killPoints) || 0) * 10) / 10,
    };
  }

  function normalizeStock(stock) {
    return {
      coupons: Math.max(0, Number(stock?.coupons) || 0),
      puzzles: Math.max(0, Number(stock?.puzzles) || 0),
      starCoupons: Math.max(0, Number(stock?.starCoupons ?? stock?.stock_star_coupons) || 0),
      legendaryStars1: Math.max(0, Number(stock?.legendaryStars1 ?? stock?.stock_legendary_stars_1) || 0),
      legendaryStars2: Math.max(0, Number(stock?.legendaryStars2 ?? stock?.stock_legendary_stars_2) || 0),
      legendaryStars3: Math.max(0, Number(stock?.legendaryStars3 ?? stock?.stock_legendary_stars_3) || 0),
      chests: Math.max(0, Number(stock?.chests) || 0),
    };
  }

  function calculateTotalStarPoints(stock = {}) {
    const s1 = Math.max(0, Number(stock?.legendaryStars1 ?? stock?.stock_legendary_stars_1) || 0);
    const s2 = Math.max(0, Number(stock?.legendaryStars2 ?? stock?.stock_legendary_stars_2) || 0);
    const s3 = Math.max(0, Number(stock?.legendaryStars3 ?? stock?.stock_legendary_stars_3) || 0);
    return (s1 * 110) + (s2 * 420) + (s3 * 960);
  }

  function cleanOcrNumber(raw) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
    }
    if (!raw || typeof raw !== 'string') return 0;

    let s = raw.trim();
    if (!s) return 0;

    if (!/\d/.test(s)) {
      return 0;
    }

    const suffixMatch = s.match(/([0-9.,\s']+)\s*([KkMmBb])(?:\b|$)/);
    if (suffixMatch) {
      let numPart = suffixMatch[1].replace(/[\s']/g, '');
      const multChar = suffixMatch[2].toUpperCase();
      const mult = multChar === 'B' ? 1e9 : multChar === 'M' ? 1e6 : multChar === 'K' ? 1e3 : 1;
      const commaCount = (numPart.match(/,/g) || []).length;
      const dotCount = (numPart.match(/\./g) || []).length;
      if (commaCount + dotCount === 1) {
        numPart = numPart.replace(',', '.');
      } else {
        numPart = numPart.replace(/[,.](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
      }
      const val = parseFloat(numPart);
      if (!Number.isNaN(val) && Number.isFinite(val)) {
        return Math.max(0, Math.round(val * mult));
      }
    }

    s = s
      .replace(/(\d)[Oo]/g, '$10')
      .replace(/[Oo](\d)/g, '0$1')
      .replace(/(\d)[LlI]/g, '$11')
      .replace(/[LlI](\d)/g, '1$1')
      .replace(/^([LlI])(?=[,.'\s]?\d)/g, '1')
      .replace(/(\d[,.'\s]?)[Oo]$/g, '$10');

    const digits = s.replace(/[^0-9]/g, '');
    if (!digits) return 0;
    const parsed = parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function parseProfileScreenshotText(text) {
    if (!text || typeof text !== 'string') {
      return { isProfile: false, sector: {} };
    }

    const sector = {};

    const tagMatch = text.match(/\[([A-Za-zА-Яа-яЁё0-9_#]{2,12})\]\s*([^\r\n,;:()]{1,35})/);
    if (tagMatch) {
      sector.allianceTag = tagMatch[1].trim();
      sector.name = tagMatch[2].trim();
    } else {
      const nameMatch = text.match(/(?:Ник(?:нейм)?|Имя|Командир)\s*[:：]?\s*([^\r\n,;:()]{1,35})/i);
      if (nameMatch) {
        const rawName = nameMatch[1].trim();
        const innerTag = rawName.match(/^\[([A-Za-zА-Яа-яЁё0-9_#]+)\]\s*(.*)$/);
        if (innerTag) {
          sector.allianceTag = innerTag[1].trim();
          sector.name = innerTag[2].trim();
        } else {
          sector.name = rawName;
        }
      }
    }

    const powerMatch = text.match(/(?:Сила|Мощь|Power)\s*[:：]?\s*([0-9OoLlI.,\s']+)/i);
    if (powerMatch) {
      const powerVal = cleanOcrNumber(powerMatch[1]);
      if (powerVal > 0) sector.power = powerVal;
    }

    const killsMatch = text.match(/(?:Уничтожено(?:\s+юнитов|\s+войск)?|Убито|Kills)\s*[:：]?\s*([0-9OoLlI.,\s']+)/i);
    if (killsMatch) {
      const killsVal = cleanOcrNumber(killsMatch[1]);
      if (killsVal > 0) sector.kills = killsVal;
    }

    const kpRegex = /(?:Очки\s+(?:за\s+)?убийств[ао]?|Kill\s*Points?)\s*[:：]?\s*([0-9OoLlI.,\s']+(?:[KkMmBb])?)/gi;
    let exactKp = 0;
    let roundedKp = 0;
    let match;
    while ((match = kpRegex.exec(text)) !== null) {
      const rawVal = match[1].trim();
      const isSuffix = /[KkMmBb]$/i.test(rawVal);
      const cleaned = cleanOcrNumber(rawVal);
      if (cleaned > 0) {
        if (!isSuffix && cleaned > 1000) {
          exactKp = cleaned;
        } else if (!roundedKp) {
          roundedKp = cleaned;
        }
      }
    }
    const finalKp = exactKp || roundedKp;
    if (finalKp > 0) {
      sector.killPoints = finalKp;
    }

    const hasStats = Boolean(sector.power || sector.kills || sector.killPoints);
    const hasWarehouseMarkers = /(?:[ВB8]?\s*[HНнh][аa][лпдnu]+[иеыкum]+|предмет|звезд|опыт|купон\s+готовност|медал[ья]\s+легендарн)/i.test(text);

    // Если в скриншоте есть явные складские маркеры и нет боевых параметров (сила, убийства) — это инвентарь/склад, а не профиль
    if (hasWarehouseMarkers && !hasStats) {
      return { isProfile: false, sector: {} };
    }

    const isProfile = Boolean(hasStats || sector.name || sector.allianceTag);
    return { isProfile, sector };
  }

  const WAREHOUSE_ITEM_DEFINITIONS = [
    {
      key: 'coupons',
      pattern: /Купон\s+готовности\s+офицера/i,
    },
    {
      key: 'puzzles',
      pattern: /Медаль\s+легендарного\s+офицера/i,
    },
    {
      key: 'starCoupons',
      pattern: /Купон\s+готовности\s+звезд[ыае]?/i,
    },
    {
      key: 'legendaryStars3',
      pattern: /(?:960[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27\"\`]?звезд[аы]\s*[‘'\x27\"\`]?(?:III|iii|3|Ⅲ|ІІІ|Ш|111|\|\|\||lll)(?=[^A-Za-zА-Яа-яЁё0-9]|$)/i,
    },
    {
      key: 'legendaryStars2',
      pattern: /(?:420[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27\"\`]?звезд[аы]\s*[‘'\x27\"\`]?(?:II|ii|2|Ⅱ|ІІ|П|11|\|\||ll)(?=[^A-Za-zА-Яа-яЁё0-9]|$)/i,
    },
    {
      key: 'legendaryStars1',
      pattern: /(?:110[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27\"\`]?звезд[аы]\s*[‘'\x27\"\`]?(?:I|i|1|Ⅰ|І|l|\||!)(?=[^A-Za-zА-Яа-яЁё0-9]|$)/i,
    },
  ];

  function parseWarehouseScreenshotText(text) {
    if (!text || typeof text !== 'string') {
      return { isWarehouse: false, stock: {} };
    }

    const stock = {};

    for (const def of WAREHOUSE_ITEM_DEFINITIONS) {
      const match = text.match(def.pattern);
      if (!match) continue;

      const startIndex = match.index + match[0].length;
      const windowText = text.slice(startIndex, startIndex + 250);

      // Ищем количество: "В наличии: <число>" строго без захвата переводов строк следующей карточки
      const countMatch = windowText.match(/(?:[ВB8]?\s*[HНнh][аa][лпдnu]+[иеыкum]+|на[лпд]ич[иеык]+)[^\S\r\n]*[:：;.]?(?:\r?\n)?[^\S\r\n]*([0-9OoLlI][0-9OoLlI., \t\x27]*)/i);
      if (countMatch) {
        const val = cleanOcrNumber(countMatch[1]);
        if (val > 0) {
          stock[def.key] = val;
        }
      } else {
        const lineMatches = windowText.split(/\r?\n/).slice(0, 4);
        for (const line of lineMatches) {
          const numMatch = line.match(/(?:^|[^\d])([0-9OoLlI][0-9OoLlI., \t\x27]{1,})/);
          if (numMatch) {
            const candidate = cleanOcrNumber(numMatch[1]);
            if (candidate > 0 && candidate !== 110 && candidate !== 420 && candidate !== 960) {
              stock[def.key] = candidate;
              break;
            }
          }
        }
      }
    }

    const isWarehouse = Object.keys(stock).length > 0;
    return { isWarehouse, stock };
  }

  function mergeScanResults(accumulated = {}, nextScan = {}) {
    const accSector = (accumulated && accumulated.sector) || {};
    const nextSector = (nextScan && nextScan.sector) || {};
    const accStock = (accumulated && accumulated.stock) || {};
    const nextStock = (nextScan && nextScan.stock) || {};

    const mergedSector = { ...accSector };
    for (const [key, val] of Object.entries(nextSector)) {
      if (val === undefined || val === null || val === '') continue;
      if (typeof val === 'number') {
        if (val === 0 && mergedSector[key]) {
          continue;
        }
        if (key === 'killPoints') {
          const currentKp = mergedSector.killPoints || 0;
          if (!currentKp) {
            mergedSector.killPoints = val;
          } else {
            const isCurrentRounded = currentKp % 100000 === 0;
            const isNewRounded = val > 0 && val % 100000 === 0;
            if (isCurrentRounded && !isNewRounded) {
              mergedSector.killPoints = val;
            } else if (!isCurrentRounded && isNewRounded) {
              // keep current exact
            } else {
              mergedSector.killPoints = val;
            }
          }
        } else {
          mergedSector[key] = val;
        }
      } else {
        mergedSector[key] = val;
      }
    }

    const mergedStock = { ...accStock };
    for (const [key, val] of Object.entries(nextStock)) {
      if (val === undefined || val === null) continue;
      if (typeof val === 'number') {
        if (val > 0 || mergedStock[key] === undefined) {
          mergedStock[key] = val;
        }
      } else {
        mergedStock[key] = val;
      }
    }

    return {
      sector: mergedSector,
      stock: mergedStock,
    };
  }

  function parseExchangeShopScreenshotText(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    const results = [];
    let currentGeneration = 8;

    const topSeasonMatch = text.match(/(?:сезон|season|s|с)\s*(\d+)/i);
    if (topSeasonMatch) {
      currentGeneration = parseInt(topSeasonMatch[1], 10) || 8;
    }

    const STOP_PATTERN = /^(?:обмен|0бмен|магазин|обновления|сезон|медали|офицера|офицер|стоимость|до|вход|время|таймер|купоны|звезды|season|exchange|shop|medals|officer)$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const seasonLineMatch = line.match(/(?:сезон|season)\s*(\d+)/i);
      if (seasonLineMatch) {
        currentGeneration = parseInt(seasonLineMatch[1], 10) || currentGeneration;
      }

      let nameCandidate = '';
      let genCandidate = currentGeneration;

      // Бейдж сезона: S8, С8, S 8, С 8, [S8], (S8), 58
      const sBadgeMatch = line.match(/^[\(\[]?[SsСс5]\s*(\d+)[\)\]\.]?\s*(.*)$/);
      if (sBadgeMatch) {
        genCandidate = parseInt(sBadgeMatch[1], 10) || currentGeneration;
        nameCandidate = (sBadgeMatch[2] || '').trim();
        if (!nameCandidate && i + 1 < lines.length) {
          const nextCandidate = lines[i + 1].trim();
          if (!STOP_PATTERN.test(nextCandidate) && !/^(?:x\d+|110)/i.test(nextCandidate)) {
            nameCandidate = nextCandidate;
          }
        }
      } else if (
        !STOP_PATTERN.test(line) &&
        !line.match(/(?:обмен|магазин|обновления|сезон)/i) &&
        !line.match(/^\d+/) &&
        !line.match(/^(?:[xXхХ]\s*\d+|110\s*[xXхХ]\s*\d+)/i) &&
        line.length >= 2 &&
        line.length <= 30
      ) {
        const nextFew = lines.slice(i + 1, i + 6).join(' ');
        if (/(?:ОБМЕН|0БМЕН|ОБMEH|EXCHANGE|Обмен)/i.test(nextFew) || /[xXхХ]\s*1/i.test(nextFew) || /\b(?:720|600|500|360|300|250)\b/.test(nextFew)) {
          nameCandidate = line;
        }
      }

      if (nameCandidate) {
        nameCandidate = nameCandidate
          .replace(/^[\(\[]?[SsСс5]\s*\d+[\)\]\.]?\s*/, '')
          .replace(/^(?:ОБМЕН|0БМЕН|x\d+|х\d+|110)/i, '')
          .replace(/^[^a-zA-Zа-яА-ЯёЁ]+/, '')
          .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s-]+$/, '')
          .trim();
      }

      if (
        nameCandidate &&
        nameCandidate.length >= 2 &&
        !STOP_PATTERN.test(nameCandidate) &&
        !/(?:магазин|обновления)/i.test(nameCandidate)
      ) {
        const windowLines = lines.slice(i, i + 8);
        const windowText = windowLines.join('\n');

        let couponPerPuzzle = genCandidate === 7 ? 600 : (genCandidate <= 6 ? 500 : 720);
        let starCouponCost = genCandidate === 7 ? 300 : (genCandidate <= 6 ? 250 : 360);

        // Поиск стоимости звезд: 110 x1 360
        const starMatch = windowText.match(/110\s*[xXхХ*]?\s*1?\s*(\d{3,4})/);
        if (starMatch) {
          starCouponCost = parseInt(starMatch[1], 10);
        }

        // Поиск стоимости фрагмента/пазла (x1 720 без префикса 110)
        for (let w = i; w < Math.min(lines.length, i + 7); w++) {
          const l = lines[w];
          if (/110/.test(l)) continue;
          const pMatch = l.match(/[xXхХ*]\s*1\s+(\d{3,4})/);
          if (pMatch) {
            couponPerPuzzle = parseInt(pMatch[1], 10);
            break;
          }
          const exMatch = l.match(/(\d{3,4})\s*(?:ОБМЕН|0БМЕН|ОБMEH|EXCHANGE|Обмен)/i);
          if (exMatch) {
            couponPerPuzzle = parseInt(exMatch[1], 10);
            break;
          }
        }

        // Определение типа войск, если встретилось рядом
        let troopType = 'Пехота';
        if (/Танк/i.test(windowText)) troopType = 'Танк';
        else if (/ПТ-Сау|ПТ\s*Сау/i.test(windowText)) troopType = 'ПТ-Сау';
        else if (/Горнизон/i.test(windowText)) troopType = 'Горнизон';
        else if (/Осада/i.test(windowText)) troopType = 'Осада';
        else if (/Пехота/i.test(windowText)) troopType = 'Пехота';

        if (!results.some(r => r.name.toLowerCase() === nameCandidate.toLowerCase())) {
          results.push({
            name: nameCandidate,
            generation: genCandidate,
            type: troopType,
            couponPerPuzzle,
            starCouponCost,
            medalsBeforeTraining: 690,
            medalsTraining: 900,
            medalsTotal: 1590,
            upgradeType: 'standard'
          });
        }
      }
    }

    return results;
  }

  function migrateState(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const oldPlayers = Array.isArray(input.players) ? input.players : [];
    const officerCatalog = uniqueCatalog(input.officerCatalog, oldPlayers);
    const byName = new Map(officerCatalog.map(o => [o.name.toLowerCase(), o]));

    const players = oldPlayers.map(player => ({
      id: player.id,
      name: player.name || '',
      realName: player.realName || '',
      rank: ['r3', 'r4', 'r5'].includes(player.rank) ? player.rank : 'r3',
      sector: normalizeSector(player.sector),
      stock: normalizeStock(player.stock),
      officers: (player.officers || []).map(officer => {
        const catalog = officer.catalogId
          ? officerCatalog.find(item => item.id === officer.catalogId)
          : byName.get(String(officer.name || '').toLowerCase());
        return {
          id: officer.id || `po-${Date.now()}`,
          catalogId: catalog?.id || officerCatalog[0].id,
          name: officer.name || catalog?.name || '',
          level: Math.max(0, Math.min(MAX_LEVEL - 1, Number(officer.level) || 0)),
          coupons: Math.max(0, Number(officer.coupons) || 0),
          stars: Math.max(0, Math.min(5, Number(officer.stars) || 0)),
        };
      }),
    }));

    return {
      version: 3,
      players,
      officerCatalog,
      eventTypes: Array.isArray(input.eventTypes) ? input.eventTypes : [],
      events: Array.isArray(input.events) ? input.events : [],
      stockHistory: Array.isArray(input.stockHistory) ? input.stockHistory : [],
      currentRole: ['r3', 'r4', 'r5'].includes(input.currentRole) ? input.currentRole : 'r5',
      currentPlayerId: input.currentPlayerId ?? players[0]?.id ?? null,
      nextId: Math.max(Number(input.nextId) || 1, 1),
    };
  }

  function calculateTotalMedals(beforeTraining = 480, training = 900) {
    const b = Math.max(0, parseInt(beforeTraining, 10) || 0);
    const t = Math.max(0, parseInt(training, 10) || 0);
    return b + t;
  }

  function dailyRewards(sector, vipTiers) {
    const vip = Number(sector?.vipLevel) || 0;
    const confidentiality = Number(sector?.confidentialityLevel) || 0;
    let vipPuzzles = 0;
    if (Array.isArray(vipTiers) && vipTiers.length > 0) {
      const tier = vipTiers.find(t => t.level === vip);
      vipPuzzles = tier ? Number(tier.dailyPuzzles ?? tier.daily_puzzles ?? 0) : 0;
    } else {
      vipPuzzles = vip > 10 ? Math.min(20, Math.max(2, vip - 9)) : 0;
    }
    const confidentialityPuzzles = confidentiality >= 25 ? 2 / 3 : confidentiality > 24 ? 1 / 2 : 0;
    return { puzzlesPerDay: vipPuzzles + confidentialityPuzzles, chestsPerDay: 1 };
  }

  function totalPuzzlesForOfficer(officer, catalogItem) {
    const rawCost = Number(catalogItem?.couponPerPuzzle);
    if (rawCost === 0) return officer.level * PUZZLES_PER_LEVEL;
    const couponPerPuzzle = rawCost || COUPON_PER_PUZZLE;
    return officer.level * PUZZLES_PER_LEVEL + Math.floor((Number(officer.coupons) || 0) / couponPerPuzzle);
  }

  function dateAdd(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function starCostFor(stars) {
    return STAR_COSTS[Math.max(1, Math.min(5, Number(stars) || 1)) - 1];
  }

  function formatOfficerStarHint(currentStars) {
    const count = Math.max(0, Math.min(5, Number(currentStars) || 0));
    if (count >= 5) {
      return '5★ Максимум (98 000 звёзд)';
    }
    const next = count + 1;
    const cost = starCostFor(next);
    const formattedCost = String(cost).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `До ${next}★: ${formattedCost} звёзд`;
  }

  function calculateVipDeficit({ currentLevel = 0, currentPoints = 0, targetLevel, dailyPointsRate = 0, vipTiers } = {}) {
    const tiers = Array.isArray(vipTiers) && vipTiers.length > 0 ? vipTiers : VIP_TIERS_DATA;
    const curLvl = Math.max(0, Math.min(30, Number(currentLevel) || 0));
    const curPts = Math.max(0, Number(currentPoints) || 0);
    const tgtLvl = targetLevel !== undefined ? Math.max(0, Math.min(30, Number(targetLevel) || 0)) : Math.min(30, curLvl + 1);

    if (curLvl >= 30 || tgtLvl <= curLvl) {
      return {
        pointsNeeded: 0,
        dailyPuzzlesIncrease: 0,
        targetLevel: tgtLvl,
        daysToTargetAtCurrentRate: 0,
      };
    }

    const curTier = tiers.find(t => t.level === curLvl) || { level: curLvl, points: 0, dailyPuzzles: 0 };
    const tgtTier = tiers.find(t => t.level === tgtLvl) || tiers[tiers.length - 1];

    const pointsNeeded = Math.max(0, tgtTier.points - curPts);
    const dailyPuzzlesIncrease = Math.max(0, (tgtTier.dailyPuzzles ?? tgtTier.daily_puzzles ?? 0) - (curTier.dailyPuzzles ?? curTier.daily_puzzles ?? 0));
    const rate = Number(dailyPointsRate) || 0;
    const daysToTargetAtCurrentRate = rate > 0 ? Math.ceil(pointsNeeded / rate) : null;

    return {
      pointsNeeded,
      dailyPuzzlesIncrease,
      targetLevel: tgtLvl,
      daysToTargetAtCurrentRate,
    };
  }

  function calculateSkillMedalsProgress(skills = [1, 1, 1, 1], maxMedals = 690) {
    const arr = Array.isArray(skills) ? skills : [1, 1, 1, 1];
    const normalized = [
      Math.max(1, Math.min(5, Number(arr[0]) || 1)),
      Math.max(1, Math.min(5, Number(arr[1]) || 1)),
      Math.max(1, Math.min(5, Number(arr[2]) || 1)),
      Math.max(1, Math.min(5, Number(arr[3]) || 1)),
    ];

    const totalUpgrades = (normalized[0] - 1) + (normalized[1] - 1) + (normalized[2] - 1) + (normalized[3] - 1);
    const ceiling = Number(maxMedals) > 0 ? Number(maxMedals) : 690;

    let baseSpent = 0;
    for (let step = 0; step < totalUpgrades && step < SKILL_PROGRESSION_COSTS.length; step++) {
      baseSpent += SKILL_PROGRESSION_COSTS[step];
    }

    let spentMedals = baseSpent;
    if (ceiling !== 690) {
      spentMedals = totalUpgrades === 16 ? ceiling : Math.round((baseSpent / 690) * ceiling);
    }

    const remainingMedals = Math.max(0, ceiling - spentMedals);
    const isMaxSkills = totalUpgrades === 16 && spentMedals >= ceiling;

    return {
      spentMedals,
      totalMedals: ceiling,
      remainingMedals,
      isMaxSkills,
      skills: normalized,
    };
  }

  function getRecommendedPairings(officerId) {
    if (!officerId) return [];
    return OFFICER_PAIRINGS[String(officerId)] || [];
  }

  const DAY_SHORT_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function calculateDurationDays(startDay, endDay) {
    const s = Math.max(1, Math.min(7, Number(startDay) || 1));
    const e = Math.max(1, Math.min(7, Number(endDay) || 1));
    if (e >= s) {
      return e - s + 1;
    }
    return (7 - s) + e + 1;
  }

  function formatDayRange(startDay, endDay) {
    const s = Math.max(1, Math.min(7, Number(startDay) || 1));
    const e = Math.max(1, Math.min(7, Number(endDay) || 1));
    const dur = calculateDurationDays(s, e);
    const dayLabel = dur === 1 ? '1 день' : (dur >= 2 && dur <= 4 ? `${dur} дня` : `${dur} дней`);
    if (s === e) {
      return `${DAY_SHORT_NAMES[s]} (${dayLabel})`;
    }
    return `${DAY_SHORT_NAMES[s]}–${DAY_SHORT_NAMES[e]} (${dayLabel})`;
  }

  function generateSeasonSchedule(options = {}) {
    const {
      startDate,
      totalWeeks,
      rules,
      cyclesCount,
      presetId,
      startId = 1,
    } = options;

    // Check if legacy call: totalWeeks is undefined AND rules are empty
    if (totalWeeks === undefined && (!rules || !Array.isArray(rules) || rules.length === 0)) {
      const preset = EVENT_PRESETS.find(p => p.id === presetId) || EVENT_PRESETS[0];
      const count = Math.max(1, Number(cyclesCount) || 1);
      const baseDate = startDate && typeof startDate === 'string' ? startDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const initialId = Number(startId) || 1;
      const cycleDays = preset.cycleDays || 14;
      const durationDays = preset.durationDays || 2;

      const schedule = [];
      for (let i = 0; i < count; i++) {
        const dateFrom = dateAdd(baseDate, i * cycleDays);
        const dateTo = dateAdd(dateFrom, durationDays - 1);
        schedule.push({
          id: initialId + i,
          typeId: preset.id,
          presetId: preset.id,
          name: preset.name,
          cycleIndex: i + 1,
          dateFrom,
          dateTo,
          note: `${preset.name} (Сезон #${i + 1})`,
        });
      }
      return schedule;
    }

    const weeksCount = Math.max(1, Number(totalWeeks) || 8);
    const activeRules = (Array.isArray(rules) && rules.length > 0)
      ? rules
      : EVENT_PRESETS;

    const baseInputDate = startDate && typeof startDate === 'string' ? startDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    // Find base Monday of the week containing baseInputDate
    const rawD = new Date(`${baseInputDate}T00:00:00Z`);
    const d = isNaN(rawD.getTime()) ? new Date() : rawD;
    const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const baseMonday = new Date(d);
    baseMonday.setUTCDate(baseMonday.getUTCDate() + diffToMonday);
    const baseMondayIso = baseMonday.toISOString().slice(0, 10);

    const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    const items = [];
    let eventSeq = 1;

    for (let w = 0; w < weeksCount; w++) {
      for (const rule of activeRules) {
        if (!rule) continue;
        const activeWeeks = Math.max(1, Number(rule.activeWeeks) || 1);
        const breakWeeks = Math.max(0, Number(rule.breakWeeks) || 0);
        const weekOffset = Math.max(0, Number(rule.weekOffset) || 0);
        const cycleLen = activeWeeks + breakWeeks;

        if (w < weekOffset) continue;
        const relWeek = (w - weekOffset) % cycleLen;
        if (relWeek >= activeWeeks) continue;

        const startDayOfWeek = Math.max(1, Math.min(7, Number(rule.startDayOfWeek) || 1));
        const endDayOfWeek = (rule.endDayOfWeek !== undefined && rule.endDayOfWeek !== null)
          ? Math.max(1, Math.min(7, Number(rule.endDayOfWeek) || 1))
          : null;
        const durationDays = endDayOfWeek !== null
          ? calculateDurationDays(startDayOfWeek, endDayOfWeek)
          : Math.max(1, Number(rule.durationDays) || 1);

        // Date of startDayOfWeek in week w:
        // Week w starts at baseMondayIso + w * 7 days (Monday = offset 0).
        // startDayOfWeek: 1 (Mon) -> offset 0, 2 (Tue) -> offset 1, ... 7 (Sun) -> offset 6.
        const dayOffsetInWeek = startDayOfWeek - 1;
        const totalStartOffset = (w * 7) + dayOffsetInWeek;
        const dateFrom = dateAdd(baseMondayIso, totalStartOffset);
        const dateTo = dateAdd(dateFrom, durationDays - 1);

        const endD = new Date(`${dateTo}T00:00:00Z`);
        const endDayIso = endD.getUTCDay() === 0 ? 7 : endD.getUTCDay();

        const ruleId = rule.id || rule.typeId || slug(rule.name);

        items.push({
          id: `ev-${w}-${ruleId}-${eventSeq++}`,
          typeId: ruleId,
          typeName: rule.name,
          name: rule.name,
          color: rule.color || '#8b5cf6',
          dateFrom,
          dateTo,
          note: `Неделя ${w + 1}`,
          weekIndex: w,
          dayFromStr: DAY_NAMES[startDayOfWeek] || '',
          dayToStr: DAY_NAMES[endDayIso] || '',
          durationDays,
        });
      }
    }

    // Sort chronologically by dateFrom ASC, then name ASC
    items.sort((a, b) => {
      const cmp = a.dateFrom.localeCompare(b.dateFrom);
      if (cmp !== 0) return cmp;
      return (a.name || '').localeCompare(b.name || '');
    });

    return items;
  }

  function forecastOfficer({ today, officer, player, officerCatalog, maxDays = 3650 }) {
    const catalogItem = (officerCatalog || DEFAULT_OFFICERS).find(item => item.id === officer.catalogId) || DEFAULT_OFFICERS[0];
    const targetPuzzles = MAX_LEVEL * PUZZLES_PER_LEVEL;
    const isOnlyPersonal = Boolean(officer?.onlyPersonalPuzzles || officer?.only_personal_puzzles);
    if (isOnlyPersonal) {
      const available = totalPuzzlesForOfficer(officer, catalogItem);
      if (available >= targetPuzzles) return { date: today, days: 0, isOnlyPersonal: true };
      return { date: null, days: null, isOnlyPersonal: true };
    }
    const daily = dailyRewards(player?.sector).puzzlesPerDay;
    let available = totalPuzzlesForOfficer(officer, catalogItem) + (Number(player?.stock?.puzzles) || 0);

    for (let days = 0; days <= maxDays; days += 1) {
      if (available >= targetPuzzles) return { date: dateAdd(today, days), days };
      available += daily;
    }

    return { date: null, days: null };
  }

  function forecastOfficerVariants({ today, officer, player, officerCatalog, eventType, maxDays = 3650 }) {
    const places = eventType?.places || [];
    const byPlace = new Map(places.map(p => [p.place, p]));
    const variants = {
      top1: byPlace.get(1),
      top2: byPlace.get(2),
      top3: byPlace.get(3),
      top4to10: byPlace.get(4),
    };

    return Object.fromEntries(Object.entries(variants).map(([key, place]) => {
      const playerWithPrize = {
        ...player,
        stock: {
          ...player.stock,
          puzzles: (Number(player.stock?.puzzles) || 0) + Math.floor((Number(place?.coupons) || 0) / COUPON_PER_PUZZLE),
        },
      };
      return [key, forecastOfficer({ today, officer, player: playerWithPrize, officerCatalog, maxDays })];
    }));
  }

  function resolveEventPlaces(eventType, eventDate) {
    const history = Array.isArray(eventType?.prizeHistory) ? eventType.prizeHistory : [];
    const matched = history
      .filter(item => item.date <= eventDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    return (matched?.places || eventType?.places || []).map(place => ({ ...place }));
  }

  function officerUsage(catalogId, players) {
    return (players || []).filter(player => (player.officers || []).some(officer => officer.catalogId === catalogId));
  }

  function canDeleteOfficer(catalogId, players) {
    const blockers = officerUsage(catalogId, players);
    return { ok: blockers.length === 0, blockers };
  }

  function canR3SubmitResult({ event, place, nowIso, players=null }) {
    const deadline = new Date(`${event.dateTo}T00:00:00Z`);
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    const assignment = (event.assignments || []).find(item => item.place === place);
    const assignedPlayerExists = assignment?.playerId && (!players || players.some(player => player.id === assignment.playerId));
    return new Date(nowIso) >= deadline && !assignedPlayerExists;
  }

  function validateImportData(data) {
    const ok = !!data
      && typeof data === 'object'
      && Array.isArray(data.players)
      && Array.isArray(data.eventTypes)
      && Array.isArray(data.events)
      && data.players.every(player => !player.officers || Array.isArray(player.officers))
      && data.eventTypes.every(type => !type.places || Array.isArray(type.places))
      && data.events.every(event => !event.assignments || Array.isArray(event.assignments));
    return { ok, error: ok ? '' : 'Неверный формат данных' };
  }

  function buildAutoPick({ places, players, officerCatalog }) {
    const byId = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
    const candidates = [];

    (players || []).forEach(player => {
      (player.officers || []).forEach(officer => {
        const catalog = byId.get(officer.catalogId) || {};
        candidates.push({
          playerId: player.id,
          officerId: officer.id,
          generation: Number(catalog.generation) || 0,
          level: Number(officer.level) || 0,
          killPoints: Number(player.sector?.killPoints) || 0,
          stockScore: (Number(player.stock?.puzzles) || 0) + Math.floor((Number(player.stock?.coupons) || 0) / COUPON_PER_PUZZLE),
        });
      });
    });

    candidates.sort((a, b) =>
      b.generation - a.generation
      || b.level - a.level
      || b.killPoints - a.killPoints
      || b.stockScore - a.stockScore
    );

    return (places || []).map((place, index) => ({
      place: place.place,
      playerId: candidates[index]?.playerId || null,
      officerId: candidates[index]?.officerId || null,
    }));
  }

  function calculateOfficerDeficit({ officer, catalogItem, player, targetLevel = 180, today, includeStock = true }) {
    const isOnlyPersonalPuzzles = Boolean(officer?.onlyPersonalPuzzles || officer?.only_personal_puzzles);
    const rawCost = Number(catalogItem?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);
    const target = Math.max(1, Math.min(MAX_LEVEL, Number(targetLevel) || MAX_LEVEL));
    const targetPuzzles = target * PUZZLES_PER_LEVEL;

    const officerCoupons = Math.max(0, Number(officer?.coupons) || 0);
    const officerLevel = Math.max(0, Number(officer?.level) || 0);
    const personalPuzzles = Math.max(0, Number(officer?.personalPuzzles ?? officer?.personal_puzzles) || 0);
    const currentPuzzles = officerLevel * PUZZLES_PER_LEVEL
      + (costPerPuzzle > 0 ? Math.floor(officerCoupons / costPerPuzzle) : 0)
      + personalPuzzles;

    let stockPuzzles = 0;
    if (includeStock && !isOnlyPersonalPuzzles) {
      const stockPuzzlesVal = Math.max(0, Number(player?.stock?.puzzles) || 0);
      const stockCouponsVal = Math.max(0, Number(player?.stock?.coupons) || 0);
      stockPuzzles = stockPuzzlesVal + (costPerPuzzle > 0 ? Math.floor(stockCouponsVal / costPerPuzzle) : 0);
    }

    const deficitPuzzles = Math.max(0, targetPuzzles - currentPuzzles - stockPuzzles);
    const deficitCoupons = costPerPuzzle > 0 ? deficitPuzzles * costPerPuzzle : 0;

    const daily = dailyRewards(player?.sector);
    const dailyIncome = isOnlyPersonalPuzzles ? 0 : daily.puzzlesPerDay;

    const daysWithoutEvents = isOnlyPersonalPuzzles
      ? null
      : (deficitPuzzles === 0
        ? 0
        : (dailyIncome > 0 ? Math.ceil(deficitPuzzles / dailyIncome) : null));

    const baseToday = today || new Date().toISOString().slice(0, 10);
    const dateWithoutEvents = (!isOnlyPersonalPuzzles && daysWithoutEvents !== null)
      ? dateAdd(baseToday, daysWithoutEvents)
      : null;

    const currentStars = Math.max(0, Math.min(5, Number(officer?.stars) || 0));
    const requiredStars = 5;
    const isStarReady = currentStars >= requiredStars;

    return {
      targetLevel: target,
      targetPuzzles,
      currentPuzzles,
      stockPuzzles,
      deficitPuzzles,
      deficitCoupons,
      costPerPuzzle,
      dailyIncome,
      daysWithoutEvents,
      dateWithoutEvents,
      isOnlyPersonalPuzzles,
      starRequirement: {
        currentStars,
        requiredStars,
        isStarReady,
      },
    };
  }

  function simulateEventProgress({ deficitPuzzles, costPerPuzzle, dailyIncome, plannedEvents = [], today }) {
    const rawCost = Number(costPerPuzzle);
    const effectiveCost = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);

    let puzzlesFromEvents = 0;
    (plannedEvents || []).forEach(pe => {
      const count = Math.max(0, Number(pe.count) || 0);
      const coupons = Math.max(0, Number(pe.coupons) || 0);
      if (count > 0 && coupons > 0 && effectiveCost > 0) {
        puzzlesFromEvents += Math.floor((coupons * count) / effectiveCost);
      }
    });

    const initialDeficit = Math.max(0, Number(deficitPuzzles) || 0);
    const remainingDeficitPuzzles = Math.max(0, initialDeficit - puzzlesFromEvents);
    const remainingDeficitCoupons = effectiveCost > 0 ? remainingDeficitPuzzles * effectiveCost : 0;

    const baseToday = today || new Date().toISOString().slice(0, 10);
    const baseDays = initialDeficit === 0 ? 0 : (dailyIncome > 0 ? Math.ceil(initialDeficit / dailyIncome) : null);
    const simulatedDays = remainingDeficitPuzzles === 0 ? 0 : (dailyIncome > 0 ? Math.ceil(remainingDeficitPuzzles / dailyIncome) : null);
    const savedDays = (baseDays !== null && simulatedDays !== null) ? Math.max(0, baseDays - simulatedDays) : 0;
    const simulatedDate = simulatedDays !== null ? dateAdd(baseToday, simulatedDays) : null;

    return {
      puzzlesFromEvents,
      remainingDeficitPuzzles,
      remainingDeficitCoupons,
      simulatedDays,
      simulatedDate,
      savedDays,
    };
  }

  function extractSectorCalendarEvents({ events, eventTypes, playerId, officerId, today, mode = 'guaranteed' }) {
    if (!Array.isArray(events) || events.length === 0 || playerId == null) {
      return [];
    }

    const baseToday = today || new Date().toISOString().slice(0, 10);

    // Filter future and current active events ((ev.dateTo || ev.dateFrom) >= today) that are not yet accrued
    const activeEvents = events.filter(ev => {
      if (ev.accrued) return false;
      const end = ev.dateTo || ev.dateFrom;
      return end && end >= baseToday;
    });

    // Sort chronologically (dateFrom ASC, then id ASC)
    activeEvents.sort((a, b) =>
      (a.dateFrom || '').localeCompare(b.dateFrom || '') ||
      (Number(a.id) || 0) - (Number(b.id) || 0)
    );

    const eventTypeMap = new Map();
    if (Array.isArray(eventTypes)) {
      eventTypes.forEach(t => {
        if (t && t.id != null) eventTypeMap.set(String(t.id), t);
      });
    } else if (eventTypes instanceof Map) {
      for (const [k, v] of eventTypes.entries()) {
        eventTypeMap.set(String(k), v);
      }
    }

    function resolveEffectivePlace(effectivePlaces, placeNum) {
      if (!Array.isArray(effectivePlaces) || effectivePlaces.length === 0) return {};
      const exact = effectivePlaces.find(p => Number(p.place) === placeNum);
      if (exact) return exact;
      // Range fallback (e.g. place: 4 covers 4..10 in standard reward table)
      const sorted = [...effectivePlaces].sort((a, b) => Number(a.place) - Number(b.place));
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (Number(sorted[i].place) <= placeNum) return sorted[i];
      }
      return sorted[sorted.length - 1] || {};
    }

    const results = [];

    activeEvents.forEach(ev => {
      const typeId = ev.typeId ?? ev.eventType ?? ev.type;
      const eventType = (typeId != null ? eventTypeMap.get(String(typeId)) : null) || null;

      const places = (eventType ? resolveEventPlaces(eventType, ev.dateFrom) : []) || [];
      const effectivePlaces = places.length > 0 ? places : (Array.isArray(ev.places) ? ev.places : []);

      const assignments = Array.isArray(ev.assignments) ? ev.assignments : [];
      const assignment = assignments.find(a =>
        String(a.playerId) === String(playerId) &&
        (!officerId || !a.officerId || String(a.officerId) === String(officerId))
      );

      if (assignment) {
        const placeNum = Number(assignment.place) || 1;
        const placeInfo = resolveEffectivePlace(effectivePlaces, placeNum);
        const placeCoupons = (assignment.actualCoupons !== undefined && assignment.actualCoupons !== null)
          ? Number(assignment.actualCoupons)
          : (Number(placeInfo.coupons) || 0);

        results.push({
          eventId: ev.id,
          eventName: (eventType && eventType.name) || ev.name || 'Событие',
          date: ev.dateFrom,
          place: placeNum,
          coupons: placeCoupons,
          status: 'assigned',
          color: (eventType && eventType.color) || '#8b5cf6',
        });
      } else if (mode === 'optimistic') {
        const registrations = Array.isArray(ev.registrations) ? ev.registrations : [];
        const reg = registrations.find(r =>
          String(r.playerId) === String(playerId) &&
          (!officerId || !r.officerId || String(r.officerId) === String(officerId))
        );

        if (reg) {
          let placeNum = 1;
          let placeCoupons = 0;

          if (reg.desiredPlace && Number(reg.desiredPlace) > 0) {
            placeNum = Number(reg.desiredPlace);
            const placeInfo = resolveEffectivePlace(effectivePlaces, placeNum);
            placeCoupons = Number(placeInfo.coupons) || 0;
          } else {
            const placeInfo = resolveEffectivePlace(effectivePlaces, 1) || effectivePlaces[0] || {};
            placeNum = Number(placeInfo.place) || 1;
            placeCoupons = Number(placeInfo.coupons) || 0;
          }

          results.push({
            eventId: ev.id,
            eventName: (eventType && eventType.name) || ev.name || 'Событие',
            date: ev.dateFrom,
            place: placeNum,
            coupons: placeCoupons,
            status: 'registered',
            color: (eventType && eventType.color) || '#8b5cf6',
          });
        }
      }
    });

    return results;
  }

  function simulateCalendarEventProgress({ deficitPuzzles, costPerPuzzle, dailyIncome, calendarEvents = [], today, maxDays = 3650 }) {
    const rawCost = Number(costPerPuzzle);
    const effectiveCost = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);

    const initialDeficit = Math.max(0, Number(deficitPuzzles) || 0);
    const daily = Math.max(0, Number(dailyIncome) || 0);
    const baseToday = today || new Date().toISOString().slice(0, 10);
    const limitDays = Math.max(1, Number(maxDays) || 3650);

    const baseDays = initialDeficit === 0
      ? 0
      : (daily > 0 ? Math.ceil(initialDeficit / daily) : null);
    const baseDate = baseDays !== null ? dateAdd(baseToday, baseDays) : null;

    if (initialDeficit === 0) {
      return {
        baseDays: 0,
        baseDate: baseToday,
        simulatedDays: 0,
        simulatedDate: baseToday,
        savedDays: 0,
        totalCouponsFromEvents: 0,
        totalPuzzlesFromEvents: 0,
        remainingDeficitPuzzles: 0,
        remainingDeficitCoupons: 0,
        timeline: [
          {
            date: baseToday,
            type: 'finish',
            remainingDeficitPuzzles: 0,
            progressPct: 100,
          },
        ],
      };
    }

    const eventsList = Array.isArray(calendarEvents) ? calendarEvents : [];

    // Group events by effective date (active events starting before today are counted on today)
    const eventsByDate = new Map();
    let maxEventDate = baseToday;

    eventsList.forEach(ev => {
      if (!ev) return;
      const effectiveDate = (ev.date && ev.date < baseToday) ? baseToday : (ev.date || baseToday);
      if (!eventsByDate.has(effectiveDate)) {
        eventsByDate.set(effectiveDate, []);
      }
      eventsByDate.get(effectiveDate).push(ev);
      if (effectiveDate > maxEventDate) {
        maxEventDate = effectiveDate;
      }
    });

    let remainingDeficitPuzzles = initialDeficit;
    let totalCouponsFromEvents = 0;
    let totalPuzzlesFromEvents = 0;
    const timeline = [];

    let simulatedDays = null;
    let simulatedDate = null;
    let finished = false;

    for (let d = 0; d <= limitDays; d++) {
      const currentDate = dateAdd(baseToday, d);

      // Fast-forward check: if past all calendar events and daily > 0
      if (currentDate > maxEventDate && daily > 0 && remainingDeficitPuzzles > 0) {
        const daysNeeded = Math.ceil(remainingDeficitPuzzles / daily);
        simulatedDays = d + daysNeeded;
        simulatedDate = dateAdd(baseToday, simulatedDays);
        remainingDeficitPuzzles = 0;
        timeline.push({
          date: simulatedDate,
          type: 'finish',
          remainingDeficitPuzzles: 0,
          progressPct: 100,
        });
        finished = true;
        break;
      }

      // If past all calendar events and daily === 0, deficit cannot decrease further
      if (currentDate > maxEventDate && daily === 0 && remainingDeficitPuzzles > 0) {
        break;
      }

      // Check events on currentDate
      const dayEvents = eventsByDate.get(currentDate);
      if (dayEvents && dayEvents.length > 0) {
        for (const ev of dayEvents) {
          const coupons = Math.max(0, Number(ev.coupons) || 0);
          totalCouponsFromEvents += coupons;

          const gained = (effectiveCost > 0 && coupons > 0)
            ? Math.floor(coupons / effectiveCost)
            : 0;
          totalPuzzlesFromEvents += gained;
          remainingDeficitPuzzles = Math.max(0, remainingDeficitPuzzles - gained);

          const progressPct = Math.min(
            100,
            Math.round(((initialDeficit - remainingDeficitPuzzles) / initialDeficit) * 100)
          );

          timeline.push({
            date: currentDate,
            type: 'event',
            eventId: ev.eventId,
            eventName: ev.eventName,
            place: ev.place,
            coupons: ev.coupons,
            puzzlesGained: gained,
            remainingDeficitPuzzles,
            status: ev.status,
            color: ev.color || '#8b5cf6',
            progressPct,
          });

          if (remainingDeficitPuzzles <= 0) {
            simulatedDays = d;
            simulatedDate = currentDate;
            timeline.push({
              date: currentDate,
              type: 'finish',
              remainingDeficitPuzzles: 0,
              progressPct: 100,
            });
            finished = true;
            break;
          }
        }
      }

      if (finished) break;

      // End of day d: add daily VIP income
      if (daily > 0) {
        remainingDeficitPuzzles = Math.max(0, remainingDeficitPuzzles - daily);
        if (remainingDeficitPuzzles <= 0) {
          simulatedDays = d + 1;
          simulatedDate = dateAdd(baseToday, d + 1);
          timeline.push({
            date: simulatedDate,
            type: 'finish',
            remainingDeficitPuzzles: 0,
            progressPct: 100,
          });
          finished = true;
          break;
        }
      }
    }

    const remainingDeficitCoupons = effectiveCost > 0 ? remainingDeficitPuzzles * effectiveCost : 0;
    const savedDays = (baseDays !== null && simulatedDays !== null)
      ? Math.max(0, baseDays - simulatedDays)
      : 0;

    return {
      baseDays,
      baseDate,
      simulatedDays,
      simulatedDate,
      savedDays,
      totalCouponsFromEvents,
      totalPuzzlesFromEvents,
      remainingDeficitPuzzles,
      remainingDeficitCoupons,
      timeline,
    };
  }

  function smartAutoPick({ places, players, officerCatalog, eventDate }) {
    const catalogMap = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
    const today = eventDate || new Date().toISOString().slice(0, 10);

    const candidates = [];
    (players || []).forEach(player => {
      (player.officers || []).forEach(officer => {
        const cat = catalogMap.get(officer.catalogId);
        if (!cat) return;
        const costPerPuzzle = Number(cat.couponPerPuzzle);
        if (costPerPuzzle === 0) return;

        const isOnlyPersonal = Boolean(officer?.onlyPersonalPuzzles || officer?.only_personal_puzzles);
        if (isOnlyPersonal) return;

        const def = calculateOfficerDeficit({ officer, catalogItem: cat, player, targetLevel: MAX_LEVEL, today });
        if (def.deficitCoupons <= 0) return;

        candidates.push({
          playerId: player.id,
          officerId: officer.id,
          generation: Number(cat.generation) || 0,
          level: Number(officer.level) || 0,
          killPoints: Number(player.sector?.killPoints) || 0,
          deficitCoupons: def.deficitCoupons,
          deficitPuzzles: def.deficitPuzzles,
          costPerPuzzle: def.costPerPuzzle,
        });
      });
    });

    candidates.sort((a, b) =>
      b.generation - a.generation
      || b.level - a.level
      || b.killPoints - a.killPoints
      || b.deficitCoupons - a.deficitCoupons
    );

    const indexedPlaces = (places || []).map((p, idx) => ({
      slotIndex: idx,
      place: p.place,
      label: p.label || `Место ${p.place}`,
      coupons: Math.max(0, Number(p.coupons ?? p.actualCoupons) || 0),
    }));

    const sortedPlaces = [...indexedPlaces].sort((a, b) => b.coupons - a.coupons || a.slotIndex - b.slotIndex);

    const assignedPlayers = new Set();
    const assignmentMap = new Map();

    sortedPlaces.forEach(p => {
      const available = candidates.filter(c => !assignedPlayers.has(c.playerId));
      if (!available.length) return;

      const fullDeficitCandidates = available.filter(c => c.deficitCoupons >= p.coupons);
      let chosen = null;
      if (fullDeficitCandidates.length > 0) {
        chosen = fullDeficitCandidates[0];
      } else {
        chosen = [...available].sort((a, b) => b.deficitCoupons - a.deficitCoupons)[0];
      }

      if (chosen) {
        assignedPlayers.add(chosen.playerId);
        const overflow = Math.max(0, p.coupons - chosen.deficitCoupons);
        assignmentMap.set(p.slotIndex, {
          place: p.place,
          playerId: chosen.playerId,
          officerId: chosen.officerId,
          actualCoupons: p.coupons,
          deficitCoupons: chosen.deficitCoupons,
          overflowCoupons: overflow,
          isEfficient: overflow === 0,
        });
      }
    });

    return (places || []).map((p, idx) => {
      const assigned = assignmentMap.get(idx);
      if (assigned) return assigned;
      return {
        place: p.place,
        playerId: null,
        officerId: null,
        actualCoupons: Number(p.coupons ?? p.actualCoupons) || 0,
        deficitCoupons: 0,
        overflowCoupons: 0,
        isEfficient: true,
      };
    });
  }

  function smartAutoPickWithRegistrations({ event, candidates, registrations, players, officerCatalog, eventDate, recentWinners = [] } = {}) {
    const rawPlaces = event?.places || [];
    const indexedPlaces = rawPlaces.map((p, idx) => ({
      slotIndex: idx,
      place: Number(p.place) || idx + 1,
      label: p.label || `Место ${p.place || idx + 1}`,
      coupons: Math.max(0, Number(p.coupons ?? p.actualCoupons) || 0),
    }));

    const recentWinnersSet = new Set((recentWinners || []).map(id => String(id)));
    function isRecentWinner(playerId) {
      if (playerId === undefined || playerId === null) return false;
      return recentWinnersSet.has(String(playerId));
    }

    function candidateIsCooldown(c) {
      if (!c) return false;
      return Boolean(c.isCooldown !== undefined ? c.isCooldown : isRecentWinner(c.playerId));
    }

    function getCandidateDeficit(c) {
      return Math.max(0, Number(c.deficitCoupons ?? c.deficit) || 0);
    }

    function getCandidateKillPoints(c) {
      return Number(c.killPoints) || 0;
    }

    let candidateList = [];
    if (Array.isArray(candidates)) {
      candidateList = candidates
        .filter(c => !Boolean(c?.onlyPersonalPuzzles || c?.only_personal_puzzles))
        .map(c => ({
          ...c,
          isCooldown: candidateIsCooldown(c),
        }));
    } else if (Array.isArray(players)) {
      const catalogMap = new Map((officerCatalog || DEFAULT_OFFICERS).map(o => [o.id, o]));
      const today = eventDate || new Date().toISOString().slice(0, 10);
      players.forEach(player => {
        (player.officers || []).forEach(officer => {
          const cat = catalogMap.get(officer.catalogId);
          if (!cat) return;
          const costPerPuzzle = Number(cat.couponPerPuzzle);
          if (costPerPuzzle === 0) return;

          const isOnlyPersonal = Boolean(officer?.onlyPersonalPuzzles || officer?.only_personal_puzzles);
          if (isOnlyPersonal) return;

          const def = calculateOfficerDeficit({ officer, catalogItem: cat, player, targetLevel: MAX_LEVEL, today });
          if (def.deficitCoupons <= 0) return;

          candidateList.push({
            playerId: player.id,
            playerName: player.name || player.realName || '',
            officerId: officer.id,
            generation: Number(cat.generation) || 0,
            level: Number(officer.level) || 0,
            killPoints: Number(player.sector?.killPoints) || 0,
            deficitCoupons: def.deficitCoupons,
            deficitPuzzles: def.deficitPuzzles,
            costPerPuzzle: def.costPerPuzzle,
            isCooldown: isRecentWinner(player.id),
          });
        });
      });
    }

    const regList = Array.isArray(registrations) ? registrations : [];
    const regMap = new Map();
    regList.forEach(r => {
      if (r && r.playerId !== undefined && r.playerId !== null) {
        regMap.set(String(r.playerId), r);
      }
    });

    const sortedPlaces = [...indexedPlaces].sort((a, b) =>
      a.place - b.place
      || b.coupons - a.coupons
      || a.slotIndex - b.slotIndex
    );

    const assignedPlayers = new Set();
    const assignmentMap = new Map();

    function compareCandidates(a, b) {
      const coolA = candidateIsCooldown(a) ? 1 : 0;
      const coolB = candidateIsCooldown(b) ? 1 : 0;
      if (coolA !== coolB) return coolA - coolB;
      const defA = getCandidateDeficit(a);
      const defB = getCandidateDeficit(b);
      if (defB !== defA) return defB - defA;
      const kpA = getCandidateKillPoints(a);
      const kpB = getCandidateKillPoints(b);
      if (kpB !== kpA) return kpB - kpA;
      const genA = Number(a.generation) || 0;
      const genB = Number(b.generation) || 0;
      if (genB !== genA) return genB - genA;
      const lvlA = Number(a.level) || 0;
      const lvlB = Number(b.level) || 0;
      if (lvlB !== lvlA) return lvlB - lvlA;
      return 0;
    }

    sortedPlaces.forEach(slot => {
      const available = candidateList.filter(c => !assignedPlayers.has(String(c.playerId)));

      // Enforce coupon overflow protection across all groups: deficit must be >= slot coupons
      const eligible = available.filter(c => getCandidateDeficit(c) >= slot.coupons);

      // Group 1: Registered for this exact place
      const group1 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired === slot.place;
      }).sort(compareCandidates);

      // Group 2: Registered for 'Any suitable' (desiredPlace === 0)
      const group2 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired === 0;
      }).sort(compareCandidates);

      // Group 3: Registered for a higher place, didn't get it (fallback)
      const group3 = eligible.filter(c => {
        const reg = regMap.get(String(c.playerId));
        if (!reg) return false;
        if (reg.officerId && c.officerId && String(reg.officerId) !== String(c.officerId)) return false;
        const desired = reg.desiredPlace !== undefined && reg.desiredPlace !== null ? Number(reg.desiredPlace) : 0;
        return desired > 0 && desired < slot.place;
      }).sort(compareCandidates);

      // Group 4: Candidates without registrations with sufficient deficit
      const group4 = eligible.filter(c => {
        return !regMap.has(String(c.playerId));
      }).sort(compareCandidates);

      const g1Clean = group1.find(c => !candidateIsCooldown(c));
      const g2Clean = group2.find(c => !candidateIsCooldown(c));
      const g1Cooldown = group1.find(c => candidateIsCooldown(c));
      const g2Cooldown = group2.find(c => candidateIsCooldown(c));
      const g3Clean = group3.find(c => !candidateIsCooldown(c));
      const g3Cooldown = group3.find(c => candidateIsCooldown(c));
      const g4Clean = group4.find(c => !candidateIsCooldown(c));
      const g4Cooldown = group4.find(c => candidateIsCooldown(c));

      const chosen = g1Clean || g2Clean || g1Cooldown || g2Cooldown || g3Clean || g3Cooldown || g4Clean || g4Cooldown || null;

      if (chosen) {
        assignedPlayers.add(String(chosen.playerId));
        const reg = regMap.get(String(chosen.playerId));
        const deficit = getCandidateDeficit(chosen);
        assignmentMap.set(slot.slotIndex, {
          slotIndex: slot.slotIndex,
          place: slot.place,
          label: slot.label,
          playerId: chosen.playerId,
          playerName: chosen.playerName || '',
          officerId: chosen.officerId || (reg && reg.officerId) || null,
          coupons: slot.coupons,
          actualCoupons: slot.coupons,
          deficit: deficit,
          deficitCoupons: deficit,
          overflowCoupons: 0,
          isEfficient: true,
          isCooldown: candidateIsCooldown(chosen),
        });
      } else {
        assignmentMap.set(slot.slotIndex, {
          slotIndex: slot.slotIndex,
          place: slot.place,
          label: slot.label,
          playerId: null,
          playerName: '',
          officerId: null,
          coupons: slot.coupons,
          actualCoupons: slot.coupons,
          deficit: 0,
          deficitCoupons: 0,
          overflowCoupons: 0,
          isEfficient: true,
          isCooldown: false,
        });
      }
    });

    const assignments = indexedPlaces.map(p => assignmentMap.get(p.slotIndex));
    const unassignedCandidates = candidateList.filter(c => !assignedPlayers.has(String(c.playerId)));

    return {
      assignments,
      unassignedCandidates,
    };
  }

  function isOfflineMutationAllowed(options = {}) {
    if (!options || typeof options !== 'object') return false;
    const { endpoint, method } = options;
    if (!endpoint || !method) return false;
    const m = String(method).trim().toUpperCase();
    const ep = String(endpoint).trim();

    // R3 Profile update
    if (ep === '/api/my-profile' && m === 'PUT') {
      return true;
    }

    // Active sector selection & new sector creation
    if (ep === '/api/my-profile/active-sector' && m === 'POST') {
      return true;
    }
    if (ep === '/api/my-sectors' && m === 'POST') {
      return true;
    }

    // Sector updates (PUT /api/players/:id)
    if (/^\/api\/players\/\d+$/.test(ep) && m === 'PUT') {
      return true;
    }

    // Point officer operations (/api/players/:id/officers and /api/players/:id/officers/:offId)
    if (/^\/api\/players\/\d+\/officers(\/.*)?$/.test(ep) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
      return true;
    }

    // R3 Officer mutations (/api/my-profile/officers and /api/my-profile/officers/:id)
    if (ep === '/api/my-profile/officers' && (m === 'POST' || m === 'PUT')) {
      return true;
    }
    if (/^\/api\/my-profile\/officers(\/.*)?$/.test(ep) && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
      return true;
    }

    // R3 Event registrations (/api/events/:id/register or /api/events/:id/registrations and subpaths)
    if (/^\/api\/events\/[^/]+\/(register|registrations)(\/.*)?$/.test(ep) && (m === 'POST' || m === 'DELETE')) {
      return true;
    }

    return false;
  }

  function findActiveSector(sectors, activeSectorId) {
    if (!Array.isArray(sectors) || sectors.length === 0) {
      return null;
    }
    if (activeSectorId !== undefined && activeSectorId !== null && activeSectorId !== '') {
      const targetId = Number(activeSectorId);
      const found = sectors.find(s => s && Number(s.id) === targetId);
      if (found) {
        return found;
      }
    }
    return sectors[0];
  }

  function formatSectorTitle(sector) {
    if (!sector || typeof sector !== 'object') {
      return '';
    }
    const name = sector.name || 'Сектор';
    const rawVip = sector.sector?.vipLevel ?? sector.vipLevel ?? 0;
    const vip = Number(rawVip) || 0;
    const rawPower = sector.sector?.power ?? sector.power ?? 0;
    const power = Number(rawPower) || 0;

    let fmtPower;
    if (power >= 1000000) {
      fmtPower = (power / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (power >= 1000) {
      fmtPower = (power / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    } else {
      fmtPower = `${power}`;
    }

    return `${name} (VIP ${vip} · ${fmtPower})`;
  }

  function createOutboxItem({ endpoint = '', method = 'POST', body = null, id, timestamp } = {}) {
    return {
      id: id || `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      endpoint,
      method: (method || 'POST').toUpperCase(),
      body: body !== undefined && body !== null ? JSON.parse(JSON.stringify(body)) : null,
      timestamp: timestamp || Date.now(),
      retryCount: 0,
    };
  }

  function addToOutboxQueue(queue = [], item) {
    if (!item) return Array.isArray(queue) ? [...queue] : [];
    const qList = Array.isArray(queue) ? queue : [];
    const itemMethod = (item.method || '').toUpperCase();

    if (itemMethod === 'PUT') {
      const existingIndex = qList.findIndex(
        q => q && q.endpoint === item.endpoint && (q.method || '').toUpperCase() === 'PUT'
      );
      if (existingIndex !== -1) {
        const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
        return qList.map((q, idx) => {
          if (idx === existingIndex) {
            const mergedBody = (isObj(q.body) && isObj(item.body))
              ? { ...q.body, ...item.body }
              : item.body;
            return {
              ...q,
              body: mergedBody,
              timestamp: item.timestamp || Date.now(),
            };
          }
          return q;
        });
      }
    }

    return [...qList, item];
  }

  function filterOutboxQueue(queue = [], completedId) {
    if (!Array.isArray(queue)) return [];
    return queue.filter(item => item && item.id !== completedId);
  }

  function formatInputNumber(val, allowDecimals = false) {
    if (val === null || val === undefined || val === '') return '';
    const str = String(val).trim();
    if (str === '') return '';

    if (allowDecimals) {
      const hasComma = str.includes(',');
      const sep = hasComma ? ',' : (str.includes('.') ? '.' : '');
      const parts = str.split(/[,\.]/);
      let intPart = parts[0].replace(/\D/g, '');
      if (intPart === '' && (parts.length > 1 || sep)) {
        intPart = '0';
      }
      const formattedInt = intPart === '' ? '' : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      if (parts.length > 1 || sep) {
        const decPart = parts.slice(1).join('').replace(/\D/g, '');
        const usedSep = hasComma ? ',' : '.';
        return formattedInt === '' ? `0${usedSep}${decPart}` : `${formattedInt}${usedSep}${decPart}`;
      }
      return formattedInt;
    } else {
      const cleaned = str.replace(/\D/g, '');
      if (cleaned === '') return '';
      return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
  }

  function parseInputNumber(str, allowDecimals = false) {
    if (typeof str === 'number') {
      if (isNaN(str)) return 0;
      return allowDecimals ? str : Math.round(str);
    }
    if (!str) return 0;
    const s = String(str).replace(/\s+/g, '').trim();
    if (!s) return 0;
    if (allowDecimals) {
      const normalized = s.replace(',', '.');
      const num = parseFloat(normalized);
      return isNaN(num) ? 0 : num;
    }
    const cleaned = s.replace(/\D/g, '');
    if (!cleaned) return 0;
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  function sortOfficersByGeneration(officers, catalog) {
    if (!Array.isArray(officers)) return [];
    const catList = Array.isArray(catalog) ? catalog : [];
    const catMap = new Map();
    for (const c of catList) {
      if (!c) continue;
      if (c.id) catMap.set(String(c.id), c);
      if (c.name) catMap.set(String(c.name).toLowerCase(), c);
    }

    function getGen(off) {
      if (!off) return 0;
      let cat = null;
      if (off.catalogId && catMap.has(String(off.catalogId))) {
        cat = catMap.get(String(off.catalogId));
      } else if (off.id && catMap.has(String(off.id))) {
        cat = catMap.get(String(off.id));
      } else if (off.name && catMap.has(String(off.name).toLowerCase())) {
        cat = catMap.get(String(off.name).toLowerCase());
      }

      if (cat) {
        if (typeof cat.generation === 'number') return cat.generation;
        if (cat.season) {
          const m = String(cat.season).match(/\d+/);
          if (m) return parseInt(m[0], 10);
        }
      }
      if (typeof off.generation === 'number') return off.generation;
      if (off.season) {
        const m = String(off.season).match(/\d+/);
        if (m) return parseInt(m[0], 10);
      }
      return 0;
    }

    return [...officers].sort((a, b) => {
      const genA = getGen(a);
      const genB = getGen(b);
      if (genB !== genA) return genB - genA;

      const starsA = Number(a?.stars) || 0;
      const starsB = Number(b?.stars) || 0;
      if (starsB !== starsA) return starsB - starsA;

      const lvlA = Number(a?.level) || 0;
      const lvlB = Number(b?.level) || 0;
      if (lvlB !== lvlA) return lvlB - lvlA;

      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
  }

  function calculateStarStockDelta(currentStars, newStars, stock, starCouponCost = 300, invested) {
    const fromStar = Math.max(0, Math.min(5, Number(currentStars) || 0));
    const toStar = Math.max(0, Math.min(5, Number(newStars) || 0));
    const deltaPoints = STAR_CUMULATIVE_COSTS[toStar] - STAR_CUMULATIVE_COSTS[fromStar];
    const hasInvested = invested !== undefined && invested !== null;
    const inv = hasInvested ? normalizeInvested(invested) : null;

    if (deltaPoints === 0) {
      return {
        canAfford: true,
        points: 0,
        delta: { starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0 },
        ...(hasInvested ? { newInvested: { ...inv } } : {})
      };
    }

    const couponRate = Number(starCouponCost) > 0 ? Number(starCouponCost) : 300;
    const st = normalizeStock(stock);

    if (deltaPoints > 0) {
      // 1-й приоритет: купоны звезды (couponRate купонов = 110 очков)
      const availableCouponPoints = Math.floor((st.starCoupons * 110) / couponRate);
      const pointsFromCoupons = Math.min(deltaPoints, availableCouponPoints);
      let couponsToDeduct = 0;
      if (pointsFromCoupons > 0) {
        if (pointsFromCoupons === availableCouponPoints) {
          couponsToDeduct = st.starCoupons;
        } else {
          couponsToDeduct = Math.ceil((pointsFromCoupons * couponRate) / 110);
        }
      }
      let remPoints = deltaPoints - pointsFromCoupons;

      // 2-й приоритет: готовые звёзды со склада (III = 960, II = 420, I = 110)
      let deductStars3 = Math.min(st.legendaryStars3, Math.floor(remPoints / 960));
      remPoints -= deductStars3 * 960;

      let deductStars2 = Math.min(st.legendaryStars2, Math.floor(remPoints / 420));
      remPoints -= deductStars2 * 420;

      let deductStars1 = Math.min(st.legendaryStars1, Math.ceil(remPoints / 110));
      remPoints -= deductStars1 * 110;

      if (remPoints > 0) {
        if (deductStars2 < st.legendaryStars2) {
          deductStars2 += 1;
          remPoints -= 420;
        } else if (deductStars3 < st.legendaryStars3) {
          deductStars3 += 1;
          remPoints -= 960;
        }
      }

      if (remPoints > 0) {
        return {
          canAfford: false,
          deficitPoints: remPoints,
          points: deltaPoints,
          delta: { starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0 },
          ...(hasInvested ? { newInvested: { ...inv } } : {})
        };
      }

      const newInvested = inv ? {
        ...inv,
        starCoupons: inv.starCoupons + couponsToDeduct,
        legendaryStars1: inv.legendaryStars1 + deductStars1,
        legendaryStars2: inv.legendaryStars2 + deductStars2,
        legendaryStars3: inv.legendaryStars3 + deductStars3,
      } : undefined;

      return {
        canAfford: true,
        points: deltaPoints,
        delta: {
          starCoupons: couponsToDeduct ? -couponsToDeduct : 0,
          legendaryStars1: deductStars1 ? -deductStars1 : 0,
          legendaryStars2: deductStars2 ? -deductStars2 : 0,
          legendaryStars3: deductStars3 ? -deductStars3 : 0,
        },
        ...(newInvested ? { newInvested } : {})
      };
    } else {
      const refundPoints = Math.abs(deltaPoints);

      if (!hasInvested) {
        // Обратная совместимость для вызовов без invested: всё в купоны
        const couponsToAdd = Math.round((refundPoints * couponRate) / 110);
        return {
          canAfford: true,
          points: deltaPoints,
          delta: {
            starCoupons: couponsToAdd,
            legendaryStars1: 0,
            legendaryStars2: 0,
            legendaryStars3: 0,
          }
        };
      }

      // Если офицер вне трекера (все вложения равны 0): ничего не возвращать
      const isUntracked = inv.starCoupons === 0 &&
        inv.legendaryStars1 === 0 &&
        inv.legendaryStars2 === 0 &&
        inv.legendaryStars3 === 0;

      if (isUntracked) {
        return {
          canAfford: true,
          points: deltaPoints,
          delta: { starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0 },
          newInvested: { ...inv }
        };
      }

      // Полное обнуление звёзд (toStar === 0): возвращаем 100% того, что было вложено в звёзды
      if (toStar === 0) {
        return {
          canAfford: true,
          points: deltaPoints,
          delta: {
            starCoupons: inv.starCoupons,
            legendaryStars1: inv.legendaryStars1,
            legendaryStars2: inv.legendaryStars2,
            legendaryStars3: inv.legendaryStars3,
          },
          newInvested: {
            ...inv,
            starCoupons: 0,
            legendaryStars1: 0,
            legendaryStars2: 0,
            legendaryStars3: 0,
          }
        };
      }

      // Частичное понижение звёзд: LIFO (сначала звёзды III -> II -> I -> купоны)
      let remRefund = refundPoints;
      const curInv = { ...inv };
      let refundStars3 = 0;
      let refundStars2 = 0;
      let refundStars1 = 0;
      let refundStarCoupons = 0;

      if (curInv.legendaryStars3 > 0 && remRefund > 0) {
        const count = Math.min(curInv.legendaryStars3, Math.ceil(remRefund / 960));
        refundStars3 = count;
        remRefund = Math.max(0, remRefund - count * 960);
        curInv.legendaryStars3 -= count;
      }
      if (curInv.legendaryStars2 > 0 && remRefund > 0) {
        const count = Math.min(curInv.legendaryStars2, Math.ceil(remRefund / 420));
        refundStars2 = count;
        remRefund = Math.max(0, remRefund - count * 420);
        curInv.legendaryStars2 -= count;
      }
      if (curInv.legendaryStars1 > 0 && remRefund > 0) {
        const count = Math.min(curInv.legendaryStars1, Math.ceil(remRefund / 110));
        refundStars1 = count;
        remRefund = Math.max(0, remRefund - count * 110);
        curInv.legendaryStars1 -= count;
      }
      if (curInv.starCoupons > 0 && remRefund > 0) {
        const couponsNeeded = Math.round((remRefund * couponRate) / 110);
        refundStarCoupons = Math.min(curInv.starCoupons, couponsNeeded);
        curInv.starCoupons -= refundStarCoupons;
        remRefund = 0;
      }

      return {
        canAfford: true,
        points: deltaPoints,
        delta: {
          starCoupons: refundStarCoupons,
          legendaryStars1: refundStars1,
          legendaryStars2: refundStars2,
          legendaryStars3: refundStars3,
        },
        newInvested: curInv
      };
    }
  }

  function calculateSkillStockDelta(currentSkills, newSkills, stock, couponPerPuzzle = 500, upgradeType = 'standard', maxMedals = 690, invested) {
    const curMedals = calculateSkillMedalsProgress(currentSkills, maxMedals).spentMedals;
    const newMedals = calculateSkillMedalsProgress(newSkills, maxMedals).spentMedals;
    const deltaMedals = newMedals - curMedals;
    const hasInvested = invested !== undefined && invested !== null;
    const inv = hasInvested ? normalizeInvested(invested) : null;

    if (deltaMedals === 0) {
      return {
        canAfford: true,
        medals: 0,
        delta: { coupons: 0, puzzles: 0 },
        ...(hasInvested ? { newInvested: { ...inv } } : {})
      };
    }

    const st = normalizeStock(stock);
    const rate = Number(couponPerPuzzle) > 0 ? Number(couponPerPuzzle) : 0;
    const isSpecial = upgradeType === 'special' || rate === 0;

    if (deltaMedals > 0) {
      if (isSpecial) {
        if (st.puzzles < deltaMedals) {
          return {
            canAfford: false,
            deficitMedals: deltaMedals - st.puzzles,
            medals: deltaMedals,
            delta: { coupons: 0, puzzles: 0 },
            ...(hasInvested ? { newInvested: { ...inv } } : {})
          };
        }
        const newSkillPuzzles = inv ? inv.skillPuzzles + deltaMedals : 0;
        const newInvested = inv ? {
          ...inv,
          skillPuzzles: newSkillPuzzles,
          puzzles: inv.levelPuzzles + newSkillPuzzles,
        } : undefined;
        return {
          canAfford: true,
          medals: deltaMedals,
          delta: { coupons: 0, puzzles: deltaMedals ? -deltaMedals : 0 },
          ...(newInvested ? { newInvested } : {})
        };
      }

      // 1-й приоритет: купоны офицера
      const puzFromCouponsAvailable = Math.floor(st.coupons / rate);
      const takeFromCouponsPuz = Math.min(deltaMedals, puzFromCouponsAvailable);
      const couponsToDeduct = takeFromCouponsPuz * rate;
      const remMedals = deltaMedals - takeFromCouponsPuz;

      // 2-й приоритет: медали склада
      if (st.puzzles < remMedals) {
        return {
          canAfford: false,
          deficitMedals: remMedals - st.puzzles,
          medals: deltaMedals,
          delta: { coupons: 0, puzzles: 0 },
          ...(hasInvested ? { newInvested: { ...inv } } : {})
        };
      }

      const newSkillCoupons = inv ? inv.skillCoupons + couponsToDeduct : 0;
      const newSkillPuzzles = inv ? inv.skillPuzzles + remMedals : 0;
      const newInvested = inv ? {
        ...inv,
        skillCoupons: newSkillCoupons,
        skillPuzzles: newSkillPuzzles,
        coupons: inv.levelCoupons + newSkillCoupons,
        puzzles: inv.levelPuzzles + newSkillPuzzles,
      } : undefined;

      return {
        canAfford: true,
        medals: deltaMedals,
        delta: { coupons: couponsToDeduct ? -couponsToDeduct : 0, puzzles: remMedals ? -remMedals : 0 },
        ...(newInvested ? { newInvested } : {})
      };
    } else {
      const refundMedals = Math.abs(deltaMedals);

      // БЕЗ переданного invested (или офицер вне трекера): НЕ начислять купоны из воздуха!
      if (!hasInvested) {
        return {
          canAfford: true,
          medals: deltaMedals,
          delta: { coupons: 0, puzzles: 0 }
        };
      }

      // Для офицера вне трекера:
      if (inv.skillCoupons === 0 && inv.skillPuzzles === 0) {
        return {
          canAfford: true,
          medals: deltaMedals,
          delta: { coupons: 0, puzzles: 0 },
          newInvested: { ...inv }
        };
      }

      // Полный сброс навыков до базы (newMedals === 0): возвращаем ВСЕ и ТОЛЬКО вложенные в навыки купоны и медали!
      if (newMedals === 0) {
        const refundCoupons = inv.skillCoupons;
        const refundPuzzles = inv.skillPuzzles;
        const newInvested = {
          ...inv,
          skillCoupons: 0,
          skillPuzzles: 0,
          coupons: inv.levelCoupons,
          puzzles: inv.levelPuzzles,
        };
        return {
          canAfford: true,
          medals: deltaMedals,
          delta: { coupons: refundCoupons, puzzles: refundPuzzles },
          newInvested
        };
      }

      // Частичный сброс: сначала медали навыков (skillPuzzles), затем купоны навыков (skillCoupons)
      let remRefund = refundMedals;
      const curInv = { ...inv };
      let refundPuzzles = 0;
      let refundCoupons = 0;

      if (curInv.skillPuzzles > 0 && remRefund > 0) {
        refundPuzzles = Math.min(curInv.skillPuzzles, remRefund);
        remRefund -= refundPuzzles;
        curInv.skillPuzzles -= refundPuzzles;
      }
      if (curInv.skillCoupons > 0 && remRefund > 0) {
        const couponsNeeded = remRefund * rate;
        refundCoupons = Math.min(curInv.skillCoupons, couponsNeeded);
        curInv.skillCoupons -= refundCoupons;
        const medalsCovered = rate > 0 ? Math.floor(refundCoupons / rate) : 0;
        remRefund = Math.max(0, remRefund - medalsCovered);
      }

      curInv.coupons = curInv.levelCoupons + curInv.skillCoupons;
      curInv.puzzles = curInv.levelPuzzles + curInv.skillPuzzles;

      return {
        canAfford: true,
        medals: deltaMedals,
        delta: { coupons: refundCoupons, puzzles: refundPuzzles },
        newInvested: curInv
      };
    }
  }

  function calculateLevelStockDelta(currentLevel, newLevel, stock, couponPerPuzzle = 500, upgradeType = 'standard', invested) {
    const curLvl = Math.max(0, Math.min(MAX_LEVEL, Number(currentLevel) || 0));
    const newLvl = Math.max(0, Math.min(MAX_LEVEL, Number(newLevel) || 0));
    const deltaPuzzles = (newLvl - curLvl) * PUZZLES_PER_LEVEL;
    const hasInvested = invested !== undefined && invested !== null;
    const inv = hasInvested ? normalizeInvested(invested) : null;

    if (deltaPuzzles === 0) {
      return {
        canAfford: true,
        puzzles: 0,
        delta: { coupons: 0, puzzles: 0 },
        ...(hasInvested ? { newInvested: { ...inv } } : {})
      };
    }

    const st = normalizeStock(stock);
    const rate = Number(couponPerPuzzle) > 0 ? Number(couponPerPuzzle) : 0;
    const isSpecial = upgradeType === 'special' || rate === 0;

    if (deltaPuzzles > 0) {
      if (isSpecial) {
        if (st.puzzles < deltaPuzzles) {
          return {
            canAfford: false,
            deficitPuzzles: deltaPuzzles - st.puzzles,
            puzzles: deltaPuzzles,
            delta: { coupons: 0, puzzles: 0 },
            ...(hasInvested ? { newInvested: { ...inv } } : {})
          };
        }
        const newLevelPuzzles = inv ? inv.levelPuzzles + deltaPuzzles : 0;
        const newInvested = inv ? {
          ...inv,
          levelPuzzles: newLevelPuzzles,
          puzzles: newLevelPuzzles + inv.skillPuzzles,
        } : undefined;
        return {
          canAfford: true,
          puzzles: deltaPuzzles,
          delta: { coupons: 0, puzzles: deltaPuzzles ? -deltaPuzzles : 0 },
          ...(newInvested ? { newInvested } : {})
        };
      }

      // 1-й приоритет: купоны
      const puzFromCoupons = Math.floor(st.coupons / rate);
      const takeFromCoupons = Math.min(deltaPuzzles, puzFromCoupons);
      const couponsDeduct = takeFromCoupons * rate;
      const remPuzzles = deltaPuzzles - takeFromCoupons;

      if (st.puzzles < remPuzzles) {
        return {
          canAfford: false,
          deficitPuzzles: remPuzzles - st.puzzles,
          puzzles: deltaPuzzles,
          delta: { coupons: 0, puzzles: 0 },
          ...(hasInvested ? { newInvested: { ...inv } } : {})
        };
      }

      const newLevelCoupons = inv ? inv.levelCoupons + couponsDeduct : 0;
      const newLevelPuzzles = inv ? inv.levelPuzzles + remPuzzles : 0;
      const newInvested = inv ? {
        ...inv,
        levelCoupons: newLevelCoupons,
        levelPuzzles: newLevelPuzzles,
        coupons: newLevelCoupons + inv.skillCoupons,
        puzzles: newLevelPuzzles + inv.skillPuzzles,
      } : undefined;

      return {
        canAfford: true,
        puzzles: deltaPuzzles,
        delta: { coupons: couponsDeduct ? -couponsDeduct : 0, puzzles: remPuzzles ? -remPuzzles : 0 },
        ...(newInvested ? { newInvested } : {})
      };
    } else {
      const refundPuz = Math.abs(deltaPuzzles);

      // БЕЗ переданного invested (или офицер вне трекера): НЕ начислять купоны из воздуха!
      if (!hasInvested) {
        return {
          canAfford: true,
          puzzles: deltaPuzzles,
          delta: { coupons: 0, puzzles: 0 }
        };
      }

      if (inv.levelCoupons === 0 && inv.levelPuzzles === 0) {
        return {
          canAfford: true,
          puzzles: deltaPuzzles,
          delta: { coupons: 0, puzzles: 0 },
          newInvested: { ...inv }
        };
      }

      // Полный откат уровня до 0: возвращаем ровно то, что было вложено в уровень!
      if (newLvl === 0) {
        const refundCoupons = inv.levelCoupons;
        const refundPuzzles = inv.levelPuzzles;
        const newInvested = {
          ...inv,
          levelCoupons: 0,
          levelPuzzles: 0,
          coupons: inv.skillCoupons,
          puzzles: inv.skillPuzzles,
        };
        return {
          canAfford: true,
          puzzles: deltaPuzzles,
          delta: { coupons: refundCoupons, puzzles: refundPuzzles },
          newInvested
        };
      }

      // Частичный откат: LIFO (сначала медали уровня, затем купоны уровня)
      let remRefund = refundPuz;
      const curInv = { ...inv };
      let refundPuzzles = 0;
      let refundCoupons = 0;

      if (curInv.levelPuzzles > 0 && remRefund > 0) {
        refundPuzzles = Math.min(curInv.levelPuzzles, remRefund);
        remRefund -= refundPuzzles;
        curInv.levelPuzzles -= refundPuzzles;
      }
      if (curInv.levelCoupons > 0 && remRefund > 0) {
        const couponsNeeded = remRefund * rate;
        refundCoupons = Math.min(curInv.levelCoupons, couponsNeeded);
        curInv.levelCoupons -= refundCoupons;
        const puzzlesCovered = rate > 0 ? Math.floor(refundCoupons / rate) : 0;
        remRefund = Math.max(0, remRefund - puzzlesCovered);
      }

      curInv.coupons = curInv.levelCoupons + curInv.skillCoupons;
      curInv.puzzles = curInv.levelPuzzles + curInv.skillPuzzles;

      return {
        canAfford: true,
        puzzles: deltaPuzzles,
        delta: { coupons: refundCoupons, puzzles: refundPuzzles },
        newInvested: curInv
      };
    }
  }

  function calculateRetrospectiveOfficerStock({ isRetrospective = false } = {}) {
    if (isRetrospective) {
      return {
        isRetrospective: true,
        canAfford: true,
        deductStock: false,
        delta: {
          coupons: 0,
          puzzles: 0,
          starCoupons: 0,
          legendaryStars1: 0,
          legendaryStars2: 0,
          legendaryStars3: 0
        },
        newInvested: { ...INVESTED_ZERO }
      };
    }
    return {
      isRetrospective: false,
      deductStock: true
    };
  }

  function calculateInitialOfficerStockDeduction({
    officer = {},
    stock = {},
    catalogOfficer = {},
    isRetrospective = false
  } = {}) {
    const normStock = normalizeStock(stock);

    if (isRetrospective) {
      return {
        isRetrospective: true,
        canAfford: true,
        deductStock: false,
        delta: {
          coupons: 0,
          puzzles: 0,
          starCoupons: 0,
          legendaryStars1: 0,
          legendaryStars2: 0,
          legendaryStars3: 0
        },
        newStock: { ...normStock },
        invested: { ...INVESTED_ZERO }
      };
    }

    const currentStock = { ...normStock };
    const accumulatedInvested = { ...INVESTED_ZERO };
    const totalDelta = {
      coupons: 0,
      puzzles: 0,
      starCoupons: 0,
      legendaryStars1: 0,
      legendaryStars2: 0,
      legendaryStars3: 0
    };

    const rawCost = Number(catalogOfficer?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0 ? (catalogOfficer?.upgradeType === 'special' ? 0 : 500) : (rawCost || (catalogOfficer?.generation === 7 ? 600 : (catalogOfficer?.generation >= 8 ? 720 : 500)));
    const upgradeType = catalogOfficer?.upgradeType || 'standard';
    const starCouponCost = catalogOfficer?.starCouponCost || (catalogOfficer?.generation === 7 ? 300 : (catalogOfficer?.generation <= 6 ? 250 : 360));
    const maxMedals = (catalogOfficer && (catalogOfficer.medalsBeforeTraining || catalogOfficer.medals_before_training)) || 690;

    const targetLevel = Math.max(0, Math.min(180, Number(officer.level) || 0));
    const targetStars = Math.max(0, Math.min(5, Number(officer.stars) || 0));
    const rawSkills = Array.isArray(officer.skills) && officer.skills.length === 4 ? officer.skills : [1, 1, 1, 1];
    const targetSkills = rawSkills.map(s => Math.max(1, Math.min(5, Number(s) || 1)));

    // 1. Level deduction
    if (targetLevel > 0) {
      const levelRes = calculateLevelStockDelta(0, targetLevel, currentStock, costPerPuzzle, upgradeType, accumulatedInvested);
      if (!levelRes.canAfford) {
        return {
          isRetrospective: false,
          canAfford: false,
          reason: 'level',
          deficitPuzzles: levelRes.deficitPuzzles || 0,
          error: `Недостаточно ресурсов на складе для уровня (не хватает ${levelRes.deficitPuzzles || 0} пазл.)`
        };
      }
      currentStock.coupons = Math.max(0, currentStock.coupons + (levelRes.delta.coupons || 0));
      currentStock.puzzles = Math.max(0, currentStock.puzzles + (levelRes.delta.puzzles || 0));
      totalDelta.coupons += (levelRes.delta.coupons || 0);
      totalDelta.puzzles += (levelRes.delta.puzzles || 0);

      if (levelRes.newInvested) {
        accumulatedInvested.levelCoupons = levelRes.newInvested.levelCoupons;
        accumulatedInvested.levelPuzzles = levelRes.newInvested.levelPuzzles;
        accumulatedInvested.coupons = accumulatedInvested.levelCoupons + accumulatedInvested.skillCoupons;
        accumulatedInvested.puzzles = accumulatedInvested.levelPuzzles + accumulatedInvested.skillPuzzles;
      }
    }

    // 2. Stars deduction
    if (targetStars > 0) {
      const starRes = calculateStarStockDelta(0, targetStars, currentStock, starCouponCost, accumulatedInvested);
      if (!starRes.canAfford) {
        return {
          isRetrospective: false,
          canAfford: false,
          reason: 'stars',
          deficitPoints: starRes.deficitPoints || 0,
          error: `Недостаточно ресурсов на складе для звёзд (не хватает ${starRes.deficitPoints || 0} очков звёзд)`
        };
      }
      currentStock.starCoupons = Math.max(0, currentStock.starCoupons + (starRes.delta.starCoupons || 0));
      currentStock.legendaryStars1 = Math.max(0, currentStock.legendaryStars1 + (starRes.delta.legendaryStars1 || 0));
      currentStock.legendaryStars2 = Math.max(0, currentStock.legendaryStars2 + (starRes.delta.legendaryStars2 || 0));
      currentStock.legendaryStars3 = Math.max(0, currentStock.legendaryStars3 + (starRes.delta.legendaryStars3 || 0));

      totalDelta.starCoupons += (starRes.delta.starCoupons || 0);
      totalDelta.legendaryStars1 += (starRes.delta.legendaryStars1 || 0);
      totalDelta.legendaryStars2 += (starRes.delta.legendaryStars2 || 0);
      totalDelta.legendaryStars3 += (starRes.delta.legendaryStars3 || 0);

      if (starRes.newInvested) {
        accumulatedInvested.starCoupons = starRes.newInvested.starCoupons;
        accumulatedInvested.legendaryStars1 = starRes.newInvested.legendaryStars1;
        accumulatedInvested.legendaryStars2 = starRes.newInvested.legendaryStars2;
        accumulatedInvested.legendaryStars3 = starRes.newInvested.legendaryStars3;
      }
    }

    // 3. Skills deduction
    const hasSkillUpgrades = targetSkills.some(s => s > 1);
    if (hasSkillUpgrades) {
      const skillRes = calculateSkillStockDelta([1, 1, 1, 1], targetSkills, currentStock, costPerPuzzle, upgradeType, maxMedals, accumulatedInvested);
      if (!skillRes.canAfford) {
        return {
          isRetrospective: false,
          canAfford: false,
          reason: 'skills',
          deficitMedals: skillRes.deficitMedals || 0,
          error: `Недостаточно ресурсов на складе для навыков (не хватает ${skillRes.deficitMedals || 0} медалей)`
        };
      }
      currentStock.coupons = Math.max(0, currentStock.coupons + (skillRes.delta.coupons || 0));
      currentStock.puzzles = Math.max(0, currentStock.puzzles + (skillRes.delta.puzzles || 0));

      totalDelta.coupons += (skillRes.delta.coupons || 0);
      totalDelta.puzzles += (skillRes.delta.puzzles || 0);

      if (skillRes.newInvested) {
        accumulatedInvested.skillCoupons = skillRes.newInvested.skillCoupons;
        accumulatedInvested.skillPuzzles = skillRes.newInvested.skillPuzzles;
        accumulatedInvested.coupons = accumulatedInvested.levelCoupons + accumulatedInvested.skillCoupons;
        accumulatedInvested.puzzles = accumulatedInvested.levelPuzzles + accumulatedInvested.skillPuzzles;
      }
    }

    return {
      isRetrospective: false,
      canAfford: true,
      deductStock: true,
      delta: totalDelta,
      newStock: currentStock,
      invested: accumulatedInvested
    };
  }

  function calculateOfficerStockReset({
    officer = {},
    stock = {},
    catalogOfficer = {}
  } = {}) {
    const normStock = normalizeStock(stock);
    const inv = normalizeInvested(officer?.invested || officer?.invested_json);

    const delta = {
      coupons: inv.coupons,
      puzzles: inv.puzzles,
      starCoupons: inv.starCoupons,
      legendaryStars1: inv.legendaryStars1,
      legendaryStars2: inv.legendaryStars2,
      legendaryStars3: inv.legendaryStars3
    };

    const newStock = {
      ...normStock,
      coupons: normStock.coupons + delta.coupons,
      puzzles: normStock.puzzles + delta.puzzles,
      starCoupons: normStock.starCoupons + delta.starCoupons,
      legendaryStars1: normStock.legendaryStars1 + delta.legendaryStars1,
      legendaryStars2: normStock.legendaryStars2 + delta.legendaryStars2,
      legendaryStars3: normStock.legendaryStars3 + delta.legendaryStars3
    };

    return {
      canAfford: true,
      delta,
      newStock,
      newInvested: { ...INVESTED_ZERO },
      resetOfficer: {
        level: 0,
        stars: 0,
        skills: [1, 1, 1, 1],
        coupons: 0,
        personalPuzzles: 0
      }
    };
  }

  function normalizeOfficerMode(mode) {
    if (mode === 'normal' || mode === 'leveling') return 'normal';
    return 'retro';
  }

  function getOfficerModeFromStore(store, officerId) {
    if (!store || !officerId) return 'retro';
    const key = String(officerId);
    return normalizeOfficerMode(store[key]);
  }

  function setOfficerModeInStore(store, officerId, mode) {
    if (!store || !officerId) return 'retro';
    const key = String(officerId);
    const clean = normalizeOfficerMode(mode);
    store[key] = clean;
    return clean;
  }

  const REFERENCE_GENERATION_COSTS = {
    'Танк': { 2: 20, 3: 28, 4: 56, 5: 116, 6: 240, 7: 500 },
    'Пехота': { 6: 289, 7: 600 },
    'Осада': { 8: 720 }
  };

  function normalizeTroopType(type) {
    if (!type || typeof type !== 'string') return 'Танк';
    const lower = type.trim().toLowerCase();
    if (lower.includes('танк') || lower.includes('tank') || lower === 'т') return 'Танк';
    if (lower.includes('пехот') || lower.includes('infantry') || lower === 'п') return 'Пехота';
    if (lower.includes('пт') || lower.includes('сау')) return 'ПТ-Сау';
    if (lower.includes('гарнизон') || lower.includes('горнизон')) return 'Горнизон';
    if (lower.includes('осад')) return 'Осада';
    return type.trim();
  }

  function suggestOfficerPuzzleCost({
    generation = 8,
    type = 'Танк',
    upgradeType = 'standard',
    catalog = [],
    roundUpStep = 50
  } = {}) {
    if (upgradeType === 'special') {
      return {
        suggestedCost: 0,
        baseGeneration: null,
        baseCost: 0,
        baseType: type,
        multiplier: 0,
        hintText: 'Специальный офицер (только личные медали, 0 купонов)'
      };
    }

    const gen = Math.max(1, parseInt(generation, 10) || 8);
    const normType = normalizeTroopType(type);
    const catList = Array.isArray(catalog) ? catalog : [];

    // Офицеры строго того же типа войск в каталоге с положительной стоимостью
    const sameTypeOfficers = catList.filter(o => {
      const oType = normalizeTroopType(o.type);
      const cost = Number(o.couponPerPuzzle ?? o.coupon_per_puzzle ?? 0);
      return oType === normType && cost > 0;
    });

    const typeRefMap = REFERENCE_GENERATION_COSTS[normType];
    const fallbackRefMap = typeRefMap || REFERENCE_GENERATION_COSTS['Танк'];

    // 1. Если для запрашиваемого поколения есть точное значение в эталонной таблице именно для этого рода войск:
    const exactCatalogMatch = sameTypeOfficers.find(o => Number(o.generation) === gen);
    if (!exactCatalogMatch && typeRefMap && typeRefMap[gen] !== undefined) {
      return {
        suggestedCost: typeRefMap[gen],
        baseGeneration: gen,
        baseCost: typeRefMap[gen],
        baseType: normType,
        multiplier: 1.0,
        hintText: `Эталонная стоимость S${gen} ${normType}: ${typeRefMap[gen]} купонов.`
      };
    }

    // 2. Ищем базу предыдущего поколения (gen - 1) строго для этого рода войск
    let baseGen = gen - 1;
    let baseCost = 0;

    const prevInCatalog = sameTypeOfficers.find(o => Number(o.generation) === baseGen);
    if (prevInCatalog) {
      baseCost = Number(prevInCatalog.couponPerPuzzle ?? prevInCatalog.coupon_per_puzzle);
    } else if (typeRefMap && typeRefMap[baseGen] !== undefined) {
      baseCost = typeRefMap[baseGen];
    } else {
      // Ищем ближайшее меньшее поколение того же рода войск
      const sortedLower = sameTypeOfficers
        .filter(o => Number(o.generation) < gen)
        .sort((a, b) => Number(b.generation) - Number(a.generation));
      if (sortedLower.length > 0) {
        baseGen = Number(sortedLower[0].generation);
        baseCost = Number(sortedLower[0].couponPerPuzzle ?? sortedLower[0].coupon_per_puzzle);
      } else if (typeRefMap) {
        const knownGens = Object.keys(typeRefMap).map(Number).sort((a, b) => b - a);
        baseGen = knownGens[0] || 7;
        baseCost = typeRefMap[baseGen];
      } else {
        // Если род войск неизвестен в эталонах и каталоге, берем базу fallback
        const knownGens = Object.keys(fallbackRefMap).map(Number).sort((a, b) => b - a);
        baseGen = knownGens[0] || 7;
        baseCost = fallbackRefMap[baseGen] || 500;
      }
    }

    // 3. Вычисление коэффициента удорожания:
    // Базовый игровой мультипликатор из реальных данных игры (2.0716)
    let multiplier = 2.0716;

    // Вычисляем динамический коэффициент ТОЛЬКО если есть два последовательных поколения ТОГО ЖЕ типа войск
    let prev2Cost = 0;
    const prev2Gen = baseGen - 1;
    const prev2InCatalog = sameTypeOfficers.find(o => Number(o.generation) === prev2Gen);
    if (prev2InCatalog) {
      prev2Cost = Number(prev2InCatalog.couponPerPuzzle ?? prev2InCatalog.coupon_per_puzzle);
    } else if (typeRefMap && typeRefMap[prev2Gen] !== undefined) {
      prev2Cost = typeRefMap[prev2Gen];
    }

    // Рассчитываем коэффициент только между поколениями одного и того же рода войск,
    // и проверяем, чтобы он находился в разумном коридоре удвоения игры (1.8 .. 2.3)
    if (prev2Cost > 0 && baseCost > prev2Cost) {
      const dynMultiplier = baseCost / prev2Cost;
      if (dynMultiplier >= 1.8 && dynMultiplier <= 2.3) {
        multiplier = dynMultiplier;
      }
    }

    // 4. Расчёт с округлением в большую сторону
    const step = Math.max(1, parseInt(roundUpStep, 10) || 50);
    const genDiff = Math.max(1, gen - baseGen);
    const rawCost = baseCost * Math.pow(multiplier, genDiff);
    const suggestedCost = Math.ceil(rawCost / step) * step;

    const pct = Math.round((multiplier - 1) * 100);
    const fmt = typeof formatInputNumber === 'function' ? formatInputNumber : (n => Number(n).toLocaleString('ru-RU'));
    const hintText = `💡 Авторасчёт: ${fmt(suggestedCost)} купонов на основе S${baseGen} ${normType} (${fmt(baseCost)}) с округлением вверх (+${pct}%). Вы можете изменить вручную.`;

    return {
      suggestedCost,
      baseGeneration: baseGen,
      baseCost,
      baseType: normType,
      multiplier,
      hintText
    };
  }

  function filterPlayersByOfficers(players, selectedCatalogIds) {
    if (!Array.isArray(players)) return [];
    if (!Array.isArray(selectedCatalogIds) || !selectedCatalogIds.length) {
      return players;
    }
    const cleanIds = selectedCatalogIds.map(id => String(id || '').trim()).filter(Boolean);
    if (!cleanIds.length) return players;

    return players.filter(player => {
      const officers = Array.isArray(player?.officers) ? player.officers : [];
      if (!officers.length) return false;
      return cleanIds.every(reqId => {
        return officers.some(o => {
          const catId = String(o.catalogId || o.id || '');
          return catId === reqId;
        });
      });
    });
  }

  function prioritizeFilteredOfficers(officers, selectedCatalogIds, catalog) {
    const list = Array.isArray(officers) ? officers : [];
    if (!list.length) return [];
    const cleanIds = Array.isArray(selectedCatalogIds)
      ? selectedCatalogIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];

    const sortFn = typeof sortOfficersByGeneration === 'function' ? sortOfficersByGeneration : null;
    const baseSorted = sortFn ? sortFn(list, catalog) : [...list];

    if (!cleanIds.length) {
      return baseSorted.map(o => ({ ...o, isMatched: false }));
    }

    const matched = [];
    const matchedKeys = new Set();

    for (const reqId of cleanIds) {
      const found = baseSorted.find(o => String(o.catalogId || o.id || '') === reqId);
      if (found) {
        const key = found.id ? `id:${found.id}` : `cat:${found.catalogId}`;
        if (!matchedKeys.has(key)) {
          matched.push({ ...found, isMatched: true });
          matchedKeys.add(key);
        }
      }
    }

    const others = [];
    for (const o of baseSorted) {
      const key = o.id ? `id:${o.id}` : `cat:${o.catalogId}`;
      if (!matchedKeys.has(key)) {
        const isMatched = cleanIds.includes(String(o.catalogId || o.id || ''));
        others.push({ ...o, isMatched });
      }
    }

    return [...matched, ...others];
  }

  function isOfficerEligibleForSimulator(officer, catalog) {
    if (!officer) return false;
    if (Boolean(officer.onlyPersonalPuzzles || officer.only_personal_puzzles)) {
      return false;
    }

    const cat = Array.isArray(catalog) ? catalog.find(c => c.id === officer.catalogId) : null;
    if (cat?.upgradeType === 'special') {
      return false;
    }
    const rawCost = cat ? Number(cat.couponPerPuzzle) : (officer.couponPerPuzzle !== undefined ? Number(officer.couponPerPuzzle) : 500);
    if (rawCost === 0) {
      return false;
    }

    return true;
  }

  function getSimulatorEligibleOfficers(officers, catalog) {
    if (!Array.isArray(officers)) return [];
    return officers.filter(o => isOfficerEligibleForSimulator(o, catalog));
  }

  function collectUniqueOfficers(catalog = [], players = []) {
    const map = new Map();
    const catalogById = new Map();

    (catalog || []).forEach(c => {
      if (c && c.id) catalogById.set(c.id, c);
      if (c && c.name && !map.has(c.name.toLowerCase().trim())) {
        map.set(c.name.toLowerCase().trim(), {
          name: c.name.trim(),
          type: c.type || '',
          generation: c.generation !== undefined && c.generation !== null ? c.generation : ''
        });
      }
    });

    (players || []).forEach(p => {
      (p?.officers || []).forEach(o => {
        const cat = o.catalogId ? catalogById.get(o.catalogId) : null;
        const name = (o.name || cat?.name || '').trim();
        if (name && !map.has(name.toLowerCase())) {
          const type = cat?.type || o.type || '';
          const generation = cat?.generation !== undefined && cat?.generation !== null
            ? cat.generation
            : (o.generation !== undefined && o.generation !== null ? o.generation : '');
          map.set(name.toLowerCase(), {
            name,
            type,
            generation
          });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  function filterOfficersByQuery(officers = [], query = '') {
    if (!Array.isArray(officers)) return [];
    const q = (query || '').toLowerCase().trim();
    if (!q) return [...officers];
    return officers.filter(o => {
      if (!o || !o.name) return false;
      const nameMatch = o.name.toLowerCase().includes(q);
      const typeMatch = o.type ? o.type.toLowerCase().includes(q) : false;
      return nameMatch || typeMatch;
    });
  }

  function getHashForRoute(page, params = {}) {
    const p = params || {};
    switch (page) {
      case 'event_detail':
        return p.id !== undefined && p.id !== null ? `#event/${p.id}` : '#calendar';
      case 'player_detail':
        return p.id !== undefined && p.id !== null ? `#player/${p.id}` : '#sectors';
      case 'officer_detail':
        return p.id !== undefined && p.id !== null ? `#officer/${p.id}` : '#officers';
      case 'my_cabinet':
        return '#cabinet';
      case 'calendar':
        return '#calendar';
      case 'players':
        return '#sectors';
      case 'officers':
        return '#officers';
      case 'event_types':
        return '#event_types';
      case 'calculator':
        return p.tab === 'matrix' ? '#matrix' : '#calculator';
      case 'pending_registrations':
        return '#pending';
      case 'users':
        return '#users';
      case 'notifications':
        return '#notifications';
      default:
        return `#${page}`;
    }
  }

  function parseRouteFromHash(hashStr) {
    if (!hashStr || typeof hashStr !== 'string') return null;
    const clean = hashStr.replace(/^[#/!]+/, '').trim();
    if (!clean) return null;

    const [pathPart] = clean.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    if (!segments.length) return null;

    const route = segments[0].toLowerCase();
    const id = segments[1] || null;

    if (route === 'event' || route === 'events') {
      if (id) return { page: 'event_detail', params: { id } };
      return { page: 'calendar', params: {} };
    }
    if (route === 'player' || route === 'players' || route === 'sector' || route === 'sectors') {
      if (id) return { page: 'player_detail', params: { id } };
      return { page: 'players', params: {} };
    }
    if (route === 'officer' || route === 'officers') {
      if (id) return { page: 'officer_detail', params: { id } };
      return { page: 'officers', params: {} };
    }
    if (route === 'cabinet' || route === 'my_cabinet') {
      return { page: 'my_cabinet', params: {} };
    }
    if (route === 'calendar') {
      return { page: 'calendar', params: {} };
    }
    if (route === 'calculator') {
      return { page: 'calculator', params: {} };
    }
    if (route === 'matrix') {
      return { page: 'calculator', params: { tab: 'matrix' } };
    }
    if (route === 'pending' || route === 'pending_registrations') {
      return { page: 'pending_registrations', params: {} };
    }
    if (route === 'users') {
      return { page: 'users', params: {} };
    }
    if (route === 'notifications') {
      return { page: 'notifications', params: {} };
    }
    if (route === 'event_types') {
      return { page: 'event_types', params: {} };
    }
    return null;
  }

  function parseTelegramStockCommand(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    const cmdMatch = trimmed.match(/^\/(?:stock|склад)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!cmdMatch) return null;

    const argsStr = cmdMatch[1];
    if (!argsStr || !argsStr.trim()) return null;

    // Сворачиваем разделители тысяч вида "25 000" -> "25000" (1-3 цифры, пробел, ровно три нуля)
    const normalizedArgs = argsStr.replace(/\b(\d{1,3})\s+(000)\b/g, '$1$2').trim();
    const tokens = normalizedArgs.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) return null;

    const numbers = [];
    for (const token of tokens) {
      let val = null;
      const lower = token.toLowerCase();
      if (/^\d+k$/i.test(lower)) {
        val = parseInt(lower, 10) * 1000;
      } else if (/^\d+m$/i.test(lower)) {
        val = parseInt(lower, 10) * 1000000;
      } else if (/^\d+$/.test(token)) {
        val = parseInt(token, 10);
      }
      if (val === null || isNaN(val) || val < 0) return null;
      numbers.push(val);
    }

    if (!numbers.length) return null;

    const result = {
      coupons: numbers[0],
      puzzles: numbers.length > 1 ? numbers[1] : 0
    };

    if (numbers.length > 2) result.starCoupons = numbers[2];
    if (numbers.length > 3) result.legendaryStars1 = numbers[3];
    if (numbers.length > 4) result.legendaryStars2 = numbers[4];
    if (numbers.length > 5) result.legendaryStars3 = numbers[5];

    return result;
  }

  function formatStockUpdateSuccessMessage(diff, newStock, options = {}) {
    const parts = [];
    parts.push('✅ <b>Склад успешно обновлен!</b>');

    const sectorName = typeof options === 'string' ? options : (options && options.sectorName);
    if (sectorName) {
      parts.push(`👤 Сектор: <b>${escapeHtml(sectorName)}</b>`);
    }

    parts.push('\n📦 <b>Текущие запасы:</b>');
    const coupons = newStock ? (newStock.coupons || 0) : 0;
    parts.push(`• Купоны: <b>${formatInputNumber(coupons)}</b>`);

    if (newStock && newStock.puzzles !== undefined) {
      parts.push(`• Пазлы: <b>${formatInputNumber(newStock.puzzles)}</b>`);
    }
    if (newStock && newStock.starCoupons) {
      parts.push(`• Звездные купоны: <b>${formatInputNumber(newStock.starCoupons)}</b>`);
    }
    if (newStock && (newStock.legendaryStars1 || newStock.legendaryStars2 || newStock.legendaryStars3)) {
      const stars = [
        newStock.legendaryStars1 || 0,
        newStock.legendaryStars2 || 0,
        newStock.legendaryStars3 || 0
      ].join(' / ');
      parts.push(`• Звезды (I/II/III): <b>${stars}</b>`);
    }

    if (diff && diff.summary && diff.summary !== 'Без изменений') {
      parts.push(`\n📊 <b>Изменения:</b> ${escapeHtml(diff.summary)}`);
    }

    const targetDeficit = typeof options === 'number' ? options : (options && options.targetDeficit);
    const targetOfficer = options && options.targetOfficer;
    if (targetOfficer && targetDeficit !== undefined) {
      if (targetDeficit <= 0) {
        parts.push(`\n🎉 <b>${escapeHtml(targetOfficer)}</b>: дефицит закрыт! Готов к максимальной прокачке.`);
      } else {
        parts.push(`\n🎯 <b>${escapeHtml(targetOfficer)}</b>: осталось собрать <b>${formatInputNumber(targetDeficit)}</b> купонов.`);
      }
    }

    return parts.join('\n');
  }

  const USER_PERMISSIONS = Object.freeze({
    VIEW_SECTORS: 'view_sectors',     // Просмотр всех секторов и командиров альянса
    VIEW_STOCKS: 'view_stocks',       // Просмотр точных остатков складов других игроков
    VIEW_MATRIX: 'view_matrix',       // Доступ к сводной матрице гильдии в калькуляторе
    MANAGE_EVENTS: 'manage_events',   // Создание ивентов, конструктор сезонов, Smart AutoPick, все заявки
    MANAGE_CATALOG: 'manage_catalog', // Редактирование каталога офицеров, типов ивентов, VIP-тиров
    APPROVE_USERS: 'approve_users'    // Одобрение и отклонение заявок новичков на регистрацию
  });

  const PERMISSION_PRESETS = Object.freeze({
    ALL: Object.freeze({
      id: 'all',
      label: '⚡ Все права',
      permissions: Object.freeze(['view_sectors', 'view_stocks', 'view_matrix', 'manage_events', 'manage_catalog', 'approve_users'])
    }),
    ANALYTICS: Object.freeze({
      id: 'analytics',
      label: '📊 Аналитика',
      permissions: Object.freeze(['view_sectors', 'view_stocks', 'view_matrix'])
    }),
    TACTICIAN: Object.freeze({
      id: 'tactician',
      label: '🎯 Военный тактик',
      permissions: Object.freeze(['view_sectors', 'manage_events'])
    }),
    HR: Object.freeze({
      id: 'hr',
      label: '👥 Кадровик',
      permissions: Object.freeze(['view_sectors', 'approve_users'])
    }),
    RESET: Object.freeze({
      id: 'reset',
      label: '✕ Сбросить',
      permissions: Object.freeze([])
    })
  });

  function hasUserPermission(user, permission) {
    if (!user) return false;
    if (user.rank === 'r5') return true;
    if (user.rank === 'r4') return true;
    if (!Array.isArray(user.permissions)) return false;
    return user.permissions.includes(permission);
  }

  function applyPermissionPreset(presetId) {
    if (!presetId || typeof presetId !== 'string') return [];
    const normalized = presetId.toLowerCase().trim();
    const preset = Object.values(PERMISSION_PRESETS).find(p => p.id === normalized)
      || PERMISSION_PRESETS[presetId.toUpperCase()];
    if (!preset) return [];
    return [...preset.permissions];
  }

  const STOCK_DIFF_FIELDS = [
    { key: 'coupons', label: 'куп.', unit: 'куп.', name: 'Купоны' },
    { key: 'puzzles', label: 'пазл.', unit: 'пазл.', name: 'Пазлы' },
    { key: 'starCoupons', label: 'зв. куп.', unit: 'зв. куп.', name: 'Звездные купоны' },
    { key: 'legendaryStars1', label: '★ I', unit: '★ I', name: 'Звезды I' },
    { key: 'legendaryStars2', label: '★ II', unit: '★ II', name: 'Звезды II' },
    { key: 'legendaryStars3', label: '★ III', unit: '★ III', name: 'Звезды III' },
    { key: 'chests', label: 'сун.', unit: 'сун.', name: 'Сундуки' },
  ];

  function calculateStockDiff(before, after) {
    const b = normalizeStock(before);
    const a = normalizeStock(after);

    const chips = [];

    for (const item of STOCK_DIFF_FIELDS) {
      const valBefore = b[item.key] || 0;
      const valAfter = a[item.key] || 0;
      const diff = valAfter - valBefore;

      if (diff !== 0) {
        const sign = diff > 0 ? '+' : '-';
        const absVal = Math.abs(diff);
        const absFormatted = typeof formatInputNumber === 'function'
          ? (formatInputNumber(absVal) || String(absVal))
          : String(absVal);
        const space = item.unit.startsWith('★') ? '' : ' ';
        const formatted = `${sign}${absFormatted}${space}${item.unit}`;

        chips.push({
          key: item.key,
          label: item.label,
          diff,
          formatted,
          type: diff > 0 ? 'positive' : 'negative',
        });
      }
    }

    const summary = chips.length > 0
      ? chips.map(c => c.formatted).join(', ')
      : 'Без изменений';

    return {
      summary,
      chips,
    };
  }

  function getStockFreshness(updatedAt, now = new Date()) {
    if (!updatedAt) {
      return {
        status: 'unknown',
        days: null,
        label: 'нет данных',
      };
    }

    const updatedDate = new Date(updatedAt);
    if (isNaN(updatedDate.getTime())) {
      return {
        status: 'unknown',
        days: null,
        label: 'нет данных',
      };
    }

    const nowDate = now instanceof Date ? now : new Date(now);
    if (isNaN(nowDate.getTime())) {
      return {
        status: 'unknown',
        days: null,
        label: 'нет данных',
      };
    }

    const diffMs = nowDate.getTime() - updatedDate.getTime();
    const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    let status = 'fresh';
    if (days <= 7) {
      status = 'fresh';
    } else if (days <= 14) {
      status = 'warning';
    } else {
      status = 'stale';
    }

    const label = days === 0 ? 'сегодня' : `${days} дн. назад`;

    return {
      status,
      days,
      label,
    };
  }

  const DEFAULT_NOTIFICATION_TEMPLATES = Object.freeze({
    event_place_assigned: Object.freeze({
      key: 'event_place_assigned',
      title: 'Назначение призового места',
      channel: 'personal',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'eventDate', 'sectorName', 'place', 'coupons', 'link']),
      template: `🎯 <b>Вам назначено призовое место!</b>\n\nСобытие: <b>{eventName}</b>\nДата старта: <b>{eventDate}</b>\nСектор: <b>{sectorName}</b>\nНазначенное место: <b>#{place}</b>\nНаграда: <b>+{coupons}</b> призовых купонов 🎟️\n\n<i>Не забудьте подготовить ресурсы и активировать необходимые бусты перед стартом!</i>\n🔗 <a href="{link}">Открыть событие в KoW Tracker</a>`
    }),
    event_registration_opened: Object.freeze({
      key: 'event_registration_opened',
      title: 'Открытие регистрации на событие',
      channel: 'personal',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'eventDate', 'totalPlaces', 'link']),
      template: `📢 <b>Открыта подача заявок на событие!</b>\n\nСобытие: <b>{eventName}</b>\nДата проведения: <b>{eventDate}</b>\nДоступно мест по регламенту: <b>{totalPlaces}</b>\n\nПодайте заявку на желаемое место через KoW Tracker:\n🔗 <a href="{link}">Подать заявку на участие</a>`
    }),
    stock_reminder_personal: Object.freeze({
      key: 'stock_reminder_personal',
      title: 'Напоминание об актуализации склада',
      channel: 'personal',
      parseMode: 'HTML',
      placeholders: Object.freeze(['username', 'sectorName', 'daysOverdue', 'link']),
      template: `⚠️ <b>Напоминание: актуализируйте данные склада</b>\n\nПривет, <b>{username}</b>! Данные по вашему сектору <b>{sectorName}</b> не обновлялись уже <b>{daysOverdue} дн.</b>\n\nАктуальные запасы купонов, пазлов и звезд необходимы офицерам для справедливого распределения призовых мест на ивентах.\n📸 Загрузите свежий скриншот склада через Смарт-сканер:\n🔗 <a href="{link}">Обновить склад в Личном кабинете</a>`
    }),
    staff_new_user_pending: Object.freeze({
      key: 'staff_new_user_pending',
      title: 'Заявка нового бойца на регистрацию',
      channel: 'staff',
      parseMode: 'HTML',
      placeholders: Object.freeze(['username', 'sectorName', 'power', 'vip', 'link']),
      template: `🔔 <b>Новый боец ожидает одобрения!</b>\n\nПользователь: <b>@{username}</b>\nИгровой сектор: <b>{sectorName}</b>\nСила: <b>{power}</b> | VIP: <b>{vip}</b>\n\n<i>Проверьте бойца в списках альянса и подтвердите доступ:</i>\n🔗 <a href="{link}">Открыть заявки на регистрацию</a>`
    }),
    staff_event_deadline_24h: Object.freeze({
      key: 'staff_event_deadline_24h',
      title: '24 часа до старта / готовность к автоподбору',
      channel: 'staff',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'eventDate', 'registrationsCount', 'availablePlaces', 'link']),
      template: `⏳ <b>24 часа до старта события: {eventName}</b>\n\nДата старта: <b>{eventDate}</b>\nПодано заявок: <b>{registrationsCount}</b> на <b>{availablePlaces}</b> призовых мест.\n\nЗапустите автоподбор кандидатов с учетом КПД и очереди альянса:\n🔗 <a href="{link}">Открыть распределение мест и автоподбор</a>`
    }),
    staff_event_autopick_summary: Object.freeze({
      key: 'staff_event_autopick_summary',
      title: 'Сводка автоподбора мест',
      channel: 'staff',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'assignedCount', 'availablePlaces', 'topAssignmentsList', 'link']),
      template: `🎯 <b>Автоподбор успешно завершен: {eventName}</b>\n\nРаспределено мест: <b>{assignedCount} / {availablePlaces}</b>\nТоп назначенных секторов:\n{topAssignmentsList}\n\nОповещения назначенных бойцам подготовлены к отправке.\n🔗 <a href="{link}">Просмотреть и утвердить сетку в трекере</a>`
    }),
    staff_stale_stocks_alert: Object.freeze({
      key: 'staff_stale_stocks_alert',
      title: 'Сводка устаревших складов',
      channel: 'staff',
      parseMode: 'HTML',
      placeholders: Object.freeze(['totalSectors', 'freshCount', 'warningCount', 'staleCount', 'link']),
      template: `📊 <b>Отчет службы кадров: актуальность складов альянса</b>\n\nВсего активных секторов: <b>{totalSectors}</b>\n🟢 Актуальные (до 7 дн.): <b>{freshCount}</b>\n🟡 Требуют внимания (7–14 дн.): <b>{warningCount}</b>\n🔴 Устарели (>14 дн.): <b>{staleCount}</b>\n\nБойцам с устаревшими данными автоматически отправлены персональные напоминания в Telegram.\n🔗 <a href="{link}">Открыть мониторинг актуальности складов</a>`
    }),
    event_result_prompt: Object.freeze({
      key: 'event_result_prompt',
      title: 'Запрос результатов события',
      channel: 'personal',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'sectorName', 'assignedPlace', 'link']),
      template: `🏁 <b>Событие завершилось: {eventName}!</b>\n\nСектор: <b>{sectorName}</b>\nВам было назначено место: <b>#{assignedPlace}</b>\n\nПожалуйста, подтвердите фактически занятое место кнопками ниже (или в трекере) для автоматического зачисления наград на склад:\n🔗 <a href="{link}">Открыть детали события</a>`
    }),
    staff_event_completed_summary: Object.freeze({
      key: 'staff_event_completed_summary',
      title: 'Итоги события в штаб',
      channel: 'staff',
      parseMode: 'HTML',
      placeholders: Object.freeze(['eventName', 'totalAssigned', 'confirmedCount', 'unconfirmedCount', 'totalCoupons', 'link']),
      template: `🏆 <b>Итоги события: {eventName}</b>\n\nВсего участников: <b>{totalAssigned}</b>\n✅ Подтвердили результат: <b>{confirmedCount}</b>\n⏳ Ожидают подтверждения: <b>{unconfirmedCount}</b>\n🎟️ Всего добыто купонов альянсом: <b>+{totalCoupons}</b>\n\n🔗 <a href="{link}">Просмотреть итоговую сетку в трекере</a>`
    }),
    event_morning_briefing: Object.freeze({
      key: 'event_morning_briefing',
      title: 'Утренний брифинг в день события (09:00)',
      channel: 'personal',
      parseMode: 'HTML',
      placeholders: Object.freeze(['sectorName', 'eventName', 'place', 'coupons', 'officerName', 'link']),
      template: `☀️ <b>Доброе утро, {sectorName}!</b>\n\n📅 Сегодня стартует событие: <b>{eventName}</b>\n🎯 Ваше назначенное место: <b>#{place}</b> ({coupons} куп.)\n🎖 Офицер: <b>{officerName}</b>\n\n<i>Событие уже активно на игровом сервере (старт в 00:00 UTC). Желаем побед!</i>\n\n🔗 <a href="{link}">Открыть событие в трекере</a>`
    })
  });

  const NOTIFICATION_TEMPLATE_SAMPLE_DATA = Object.freeze({
    event_morning_briefing: Object.freeze({
      sectorName: 'Sector 7 (Рейнджер)',
      eventName: 'Мощные силы (Mighty Forces)',
      place: '1',
      coupons: '50',
      officerName: 'Элизабет',
      link: 'https://kow.example.com/#event/1'
    }),
    event_place_assigned: Object.freeze({
      eventName: 'Битва за трон (King of War)',
      eventDate: '2026-11-10 12:00 UTC',
      sectorName: 'Sector 7 (Рейнджер)',
      place: '1',
      coupons: '50',
      link: 'https://kow.example.com/#event/1'
    }),
    event_registration_opened: Object.freeze({
      eventName: 'Мощь времени (Power of Time)',
      eventDate: '2026-11-15 00:00 UTC',
      totalPlaces: '10',
      link: 'https://kow.example.com/#event/1'
    }),
    stock_reminder_personal: Object.freeze({
      username: 'Commander',
      sectorName: 'Sector 12 (Цитадель)',
      daysOverdue: '16',
      link: 'https://kow.example.com/#cabinet'
    }),
    staff_new_user_pending: Object.freeze({
      username: 'recruit_soldier',
      sectorName: 'Sector 99',
      power: '45.2M',
      vip: '12',
      link: 'https://kow.example.com/#pending'
    }),
    staff_event_deadline_24h: Object.freeze({
      eventName: 'Могучие войска (Mighty Forces)',
      eventDate: '2026-11-05 18:00 UTC',
      registrationsCount: '14',
      availablePlaces: '5',
      link: 'https://kow.example.com/#event/1'
    }),
    staff_event_autopick_summary: Object.freeze({
      eventName: 'Битва за трон',
      assignedCount: '5',
      availablePlaces: '5',
      topAssignmentsList: '1. #1: Sector 3 (VIP 15)\n2. #2: Sector 7 (VIP 14)\n3. #3: Sector 1 (VIP 13)',
      link: 'https://kow.example.com/#event/1'
    }),
    staff_stale_stocks_alert: Object.freeze({
      totalSectors: '42',
      freshCount: '28',
      warningCount: '8',
      staleCount: '6',
      link: 'https://kow.example.com/#sectors'
    }),
    event_result_prompt: Object.freeze({
      eventName: 'Битва за трон (King of War)',
      sectorName: 'Sector 7 (Рейнджер)',
      assignedPlace: '1',
      link: 'https://kow.example.com/#event/1'
    }),
    staff_event_completed_summary: Object.freeze({
      eventName: 'Битва за трон',
      totalAssigned: '10',
      confirmedCount: '9',
      unconfirmedCount: '1',
      totalCoupons: '320',
      link: 'https://kow.example.com/#event/1'
    })
  });

  function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderTemplate(templateText, data = {}) {
    if (typeof templateText !== 'string' || !templateText) return '';
    const d = (data && typeof data === 'object') ? data : {};
    return templateText.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      const val = d[key];
      if (val !== undefined && val !== null) {
        if (key === 'link' || key === 'topAssignmentsList') {
          return String(val);
        }
        return escapeHtml(String(val));
      }
      return '';
    });
  }

  const DEFAULT_STALE_ALERT_SCHEDULE = Object.freeze({
    frequency: 'weekly', // 'weekly' | 'semiweekly' | 'daily' | 'disabled'
    time: '10:00', // HH:MM
    smartSilence: true, // true: don't alert staff if staleCount === 0
    personalCooldownDays: 7, // 0 = disabled, 7, 14
    timezoneOffset: 3 // MSK = UTC+3
  });

  const DAY_NAMES_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  function getZonedDateParts(dateInput, timezoneOffset = 3) {
    const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
    if (isNaN(d.getTime())) return null;
    const offsetMs = Number(timezoneOffset || 0) * 60 * 60 * 1000;
    const zoned = new Date(d.getTime() + offsetMs);

    const year = zoned.getUTCFullYear();
    const month = zoned.getUTCMonth() + 1;
    const day = zoned.getUTCDate();
    const dayOfWeek = zoned.getUTCDay(); // 0 = Sun, 1 = Mon ...
    const hour = zoned.getUTCHours();
    const minute = zoned.getUTCMinutes();
    const second = zoned.getUTCSeconds();

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const min = String(minute).padStart(2, '0');

    return {
      year,
      month,
      day,
      dayOfWeek,
      hour,
      minute,
      second,
      dateString: `${year}-${mm}-${dd}`,
      timeString: `${hh}:${min}`,
      dayName: DAY_NAMES_RU[dayOfWeek] || ''
    };
  }

  function parseTimeString(timeStr) {
    if (typeof timeStr !== 'string') return { hour: 10, minute: 0 };
    const parts = timeStr.trim().split(':');
    const hour = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
    const minute = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
    return { hour, minute };
  }

  function shouldRunStaleStockAlert({
    frequency = 'weekly',
    time = '10:00',
    lastRunAt = null,
    now = null,
    timezoneOffset = 3
  } = {}) {
    if (frequency === 'disabled') return false;

    const currentZoned = getZonedDateParts(now || new Date(), timezoneOffset);
    if (!currentZoned) return false;

    // Day of week match
    // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
    if (frequency === 'weekly') {
      if (currentZoned.dayOfWeek !== 1) return false; // Mon only
    } else if (frequency === 'semiweekly') {
      if (currentZoned.dayOfWeek !== 1 && currentZoned.dayOfWeek !== 4) return false; // Mon & Thu only
    } else if (frequency === 'daily') {
      // Any day
    } else {
      return false;
    }

    // Time of day match
    const target = parseTimeString(time);
    const currentMins = currentZoned.hour * 60 + currentZoned.minute;
    const targetMins = target.hour * 60 + target.minute;
    if (currentMins < targetMins) {
      return false; // Not yet time
    }

    // Check if already ran on the same calendar day in this timezone
    if (lastRunAt) {
      const lastZoned = getZonedDateParts(lastRunAt, timezoneOffset);
      if (lastZoned && lastZoned.dateString === currentZoned.dateString) {
        return false; // Already ran today
      }
    }

    return true;
  }

  function calculateNextStaleRun({
    frequency = 'weekly',
    time = '10:00',
    now = null,
    timezoneOffset = 3
  } = {}) {
    if (frequency === 'disabled') return null;

    const currentBase = now instanceof Date ? now : (now ? new Date(now) : new Date());
    if (isNaN(currentBase.getTime())) return null;

    const target = parseTimeString(time);
    const offsetMs = Number(timezoneOffset || 0) * 60 * 60 * 1000;

    // Check up to 14 days ahead
    for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
      // Shift current base date by dayOffset in local timezone
      const checkZoned = new Date(currentBase.getTime() + offsetMs + (dayOffset * 24 * 60 * 60 * 1000));
      const dayOfWeek = checkZoned.getUTCDay();

      let dayMatches = false;
      if (frequency === 'daily') {
        dayMatches = true;
      } else if (frequency === 'weekly') {
        dayMatches = (dayOfWeek === 1);
      } else if (frequency === 'semiweekly') {
        dayMatches = (dayOfWeek === 1 || dayOfWeek === 4);
      }

      if (!dayMatches) continue;

      // Construct target UTC timestamp for that zoned day
      const targetUtcYear = checkZoned.getUTCFullYear();
      const targetUtcMonth = checkZoned.getUTCMonth();
      const targetUtcDate = checkZoned.getUTCDate();

      // target UTC millis = Date.UTC(year, month, date, targetHour, targetMin) - offsetMs
      const targetUtcMillis = Date.UTC(targetUtcYear, targetUtcMonth, targetUtcDate, target.hour, target.minute, 0, 0) - offsetMs;

      // Must be strictly in the future compared to currentBase (with 1 second tolerance)
      if (targetUtcMillis > currentBase.getTime() + 1000) {
        const nextDate = new Date(targetUtcMillis);
        const nextZoned = getZonedDateParts(nextDate, timezoneOffset);
        return {
          nextRunIso: nextDate.toISOString(),
          nextRunZonedText: `${nextZoned.dateString} ${nextZoned.timeString}`,
          dayOfWeek: nextZoned.dayOfWeek,
          dayName: nextZoned.dayName
        };
      }
    }

    return null;
  }

  function shouldSendMorningEventReminder({
    eventDateFrom,
    now = null,
    timezoneOffset = 3,
    targetHour = 9,
    lastSentDate = null
  } = {}) {
    if (!eventDateFrom) return false;
    const currentZoned = getZonedDateParts(now || new Date(), timezoneOffset);
    if (!currentZoned) return false;

    const eventStartDate = String(eventDateFrom).slice(0, 10);
    if (currentZoned.dateString !== eventStartDate) {
      return false;
    }

    if (currentZoned.hour < targetHour) {
      return false; // Sleep protection: do not send morning briefings before 9 AM
    }

    if (lastSentDate) {
      const lastZonedDate = String(lastSentDate).slice(0, 10);
      if (lastZonedDate === currentZoned.dateString) {
        return false;
      }
    }

    return true;
  }

  function formatTimezoneOffsetLabel(offsetHours, timeZoneName = null) {
    const num = Number(offsetHours || 0);
    const sign = num >= 0 ? '+' : '-';
    const abs = Math.abs(num);
    const whole = Math.floor(abs);
    const fraction = Math.round((abs - whole) * 60);
    const offsetStr = fraction > 0 ? `${whole}:${String(fraction).padStart(2, '0')}` : `${whole}`;
    const base = `UTC${sign}${offsetStr}`;
    return timeZoneName ? `${base} (${timeZoneName})` : base;
  }

  function getUserTimezoneInfo() {
    let timeZone = 'UTC';
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      }
    } catch (_) {}

    let offsetHours = 3;
    try {
      offsetHours = - (new Date().getTimezoneOffset() / 60);
    } catch (_) {}

    return {
      timeZone,
      offsetHours,
      formattedLabel: formatTimezoneOffsetLabel(offsetHours, timeZone)
    };
  }

  function convertTimeBetweenTimezones(timeStr, fromOffsetHours = 3, toOffsetHours = 3) {
    const { hour, minute } = parseTimeString(timeStr);
    const fromOffset = Number(fromOffsetHours || 0);
    const toOffset = Number(toOffsetHours || 0);

    const origMinutes = hour * 60 + minute;
    const diffMinutes = Math.round((toOffset - fromOffset) * 60);
    const totalMinutes = origMinutes + diffMinutes;

    let dayShift = 0;
    let wrappedMinutes = totalMinutes;

    if (wrappedMinutes >= 1440) {
      dayShift = Math.floor(wrappedMinutes / 1440);
      wrappedMinutes = ((wrappedMinutes % 1440) + 1440) % 1440;
    } else if (wrappedMinutes < 0) {
      dayShift = Math.floor(wrappedMinutes / 1440);
      wrappedMinutes = ((wrappedMinutes % 1440) + 1440) % 1440;
    }

    const targetHour = Math.floor(wrappedMinutes / 60);
    const targetMinute = wrappedMinutes % 60;

    const time = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;
    return {
      time,
      dayShift,
      targetHour,
      targetMinute
    };
  }

  /**
   * Formats ISO date into human-readable relative time string:
   * "только что", "X мин. назад", "X ч. назад", "вчера", "X дн. назад", "X нед. назад", "X мес. назад", "более года назад"
   * Supports 'ru', 'en', 'de' language codes via options.lang.
   */
  function formatRelativeTime(dateIso, now = new Date(), options = {}) {
    let lang = (typeof options === 'string' ? options : (options && options.lang)) || 'ru';
    if (!['ru', 'en', 'de'].includes(lang)) {
      lang = 'ru';
    }

    const labels = {
      ru: {
        never: 'Никогда',
        justNow: 'только что',
        minAgo: n => `${n} мин. назад`,
        hourAgo: n => `${n} ч. назад`,
        yesterday: 'вчера',
        dayAgo: n => `${n} дн. назад`,
        weekAgo: n => `${n} нед. назад`,
        monthAgo: n => `${n} мес. назад`,
        yearAgo: 'более года назад'
      },
      en: {
        never: 'Never',
        justNow: 'just now',
        minAgo: n => `${n}m ago`,
        hourAgo: n => `${n}h ago`,
        yesterday: 'yesterday',
        dayAgo: n => `${n}d ago`,
        weekAgo: n => `${n}w ago`,
        monthAgo: n => `${n}mo ago`,
        yearAgo: 'more than a year ago'
      },
      de: {
        never: 'Nie',
        justNow: 'gerade eben',
        minAgo: n => `vor ${n} Min.`,
        hourAgo: n => `vor ${n} Std.`,
        yesterday: 'gestern',
        dayAgo: n => `vor ${n} Tg.`,
        weekAgo: n => `vor ${n} Wo.`,
        monthAgo: n => `vor ${n} Mon.`,
        yearAgo: 'vor mehr als einem Jahr'
      }
    };

    const l = labels[lang] || labels.ru;

    if (!dateIso) return l.never;
    const targetDate = dateIso instanceof Date ? dateIso : new Date(dateIso);
    if (isNaN(targetDate.getTime())) return l.never;

    const nowDate = now instanceof Date ? now : new Date(now);
    if (isNaN(nowDate.getTime())) return l.never;

    const diffMs = nowDate.getTime() - targetDate.getTime();
    if (diffMs <= 0) return l.justNow;

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) {
      return l.justNow;
    }
    if (diffMin < 60) {
      return l.minAgo(diffMin);
    }
    if (diffHours < 24) {
      return l.hourAgo(diffHours);
    }
    if (diffDays === 1) {
      return l.yesterday;
    }
    if (diffDays < 7) {
      return l.dayAgo(diffDays);
    }

    const diffWeeks = Math.floor(diffDays / 7);
    if (diffDays < 30) {
      return l.weekAgo(diffWeeks);
    }

    const diffMonths = Math.floor(diffDays / 30);
    if (diffDays < 365) {
      return l.monthAgo(diffMonths);
    }

    return l.yearAgo;
  }

  function formatTelegramMeMessage({ user, player, freshness, targetOfficer, targetDeficit }) {
    const parts = [];
    const rankMap = { r5: 'Р5', r4: 'Р4', r3: 'Р3', r2: 'Р2', r1: 'Р1' };
    const rankLabel = rankMap[(user?.rank || '').toLowerCase()] || (user?.rank || 'Р3').toUpperCase();
    const sectorName = player?.name || user?.username || 'Сектор';
    parts.push(`👤 <b>Ваш профиль:</b> <b>${escapeHtml(sectorName)}</b> [${rankLabel}]`);

    const power = player?.power || 0;
    const powerFormatted = formatInputNumber(power);
    const vip = player?.vip !== undefined ? player.vip : (user?.vip !== undefined ? user.vip : '—');
    parts.push(`📊 Сила: <b>${powerFormatted}</b> | VIP: <b>${vip}</b>`);

    parts.push('\n📦 <b>Запасы склада:</b>');
    const stock = player?.stock || {};
    const coupons = stock.coupons || 0;
    const puzzles = stock.puzzles || 0;
    parts.push(`• Купоны: <b>${formatInputNumber(coupons)}</b> 🎟️`);
    parts.push(`• Пазлы: <b>${formatInputNumber(puzzles)}</b> 🧩`);
    if (stock.starCoupons) {
      parts.push(`• Звездные купоны: <b>${formatInputNumber(stock.starCoupons)}</b> ⭐`);
    }
    if (stock.legendaryStars1 || stock.legendaryStars2 || stock.legendaryStars3) {
      const stars = [
        stock.legendaryStars1 || 0,
        stock.legendaryStars2 || 0,
        stock.legendaryStars3 || 0
      ].join(' / ');
      parts.push(`• Звезды (I/II/III): <b>${stars}</b> ✨`);
    }

    if (freshness) {
      const badgeIcon = freshness.status === 'fresh' ? '🟢' : (freshness.status === 'warning' ? '🟡' : '🔴');
      parts.push(`• Актуальность: ${badgeIcon} ${freshness.label || (freshness.days + ' дн. назад')}`);
    }

    if (targetOfficer) {
      const offName = typeof targetOfficer === 'string' ? targetOfficer : targetOfficer.name;
      parts.push(`\n🎯 <b>Целевой офицер:</b> <b>${escapeHtml(offName)}</b>`);
      if (targetDeficit !== undefined && targetDeficit !== null) {
        if (targetDeficit <= 0) {
          parts.push('• Дефицит: <b>0</b> (готов к максимальной прокачке! 🎉)');
        } else {
          parts.push(`• Остаточный дефицит: <b>${formatInputNumber(targetDeficit)}</b> купонов`);
        }
      }
    }

    return parts.join('\n');
  }

  function formatTelegramDeficitMessage({ player, targetOfficer, deficit, dailyRewards, daysEstimate }) {
    const parts = [];
    const sectorName = player?.name || 'Сектор';
    const offName = typeof targetOfficer === 'string' ? targetOfficer : (targetOfficer?.name || 'Офицер');
    parts.push(`📊 <b>Расчет дефицита прокачки</b>`);
    parts.push(`👤 Сектор: <b>${escapeHtml(sectorName)}</b>`);
    parts.push(`🎯 Офицер: <b>${escapeHtml(offName)}</b>`);

    if (deficit) {
      parts.push('\n🎯 <b>Необходимо ресурсов:</b>');
      if (deficit.coupons !== undefined) {
        parts.push(`• Купоны: <b>${formatInputNumber(deficit.coupons)}</b> 🎟️`);
      }
      if (deficit.puzzles !== undefined) {
        parts.push(`• Пазлы: <b>${formatInputNumber(deficit.puzzles)}</b> 🧩`);
      }
      if (deficit.medalsRemaining !== undefined) {
        parts.push(`• Медалей до максимума (5-5-5-5): <b>${deficit.medalsRemaining}</b>`);
      }
    }

    if (dailyRewards && (dailyRewards.coupons || dailyRewards.puzzles)) {
      parts.push('\n👑 <b>Ежедневный доход (VIP):</b>');
      if (dailyRewards.coupons) parts.push(`• +${formatInputNumber(dailyRewards.coupons)} купонов/день`);
      if (dailyRewards.puzzles) parts.push(`• +${dailyRewards.puzzles} пазлов/день`);
    }

    if (daysEstimate !== undefined && daysEstimate !== null) {
      parts.push(`\n⏳ <b>Прогноз завершения:</b> ~<b>${daysEstimate} дн.</b>`);
    }

    return parts.join('\n');
  }

  function formatTelegramEventsListMessage({ events, playerId, mode = 'upcoming' }) {
    const parts = [];
    if (mode === 'past') {
      parts.push('🏁 <b>Прошедшие события альянса:</b>\n');
    } else {
      parts.push('📅 <b>Ближайшие события альянса:</b>\n');
    }

    if (!events || !events.length) {
      if (mode === 'past') {
        parts.push('Завершённых событий пока нет.');
      } else {
        parts.push('В ближайшее время активных событий не запланировано.');
      }
      return parts.join('\n');
    }

    events.slice(0, 5).forEach((ev, idx) => {
      const title = ev.title || ev.name || `Событие #${ev.id}`;
      const dateStr = ev.dateFrom ? new Date(ev.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';

      const assignment = (ev.assignments || []).find(a => Number(a.playerId) === Number(playerId));
      const registration = (ev.registrations || []).find(r => Number(r.playerId) === Number(playerId));

      let statusLine = '📢 <i>Открыта регистрация</i>';
      if (mode === 'past') {
        if (assignment) {
          const finalPlace = assignment.actualPlace || assignment.place;
          const coup = (assignment.actualCoupons ?? assignment.coupons) ? ` (+${assignment.actualCoupons ?? assignment.coupons} куп.)` : '';
          statusLine = `🎯 <b>Итог: Место #${finalPlace}</b>${coup}`;
        } else {
          statusLine = '◌ <i>Событие завершено</i>';
        }
      } else {
        if (assignment) {
          const place = assignment.place;
          const coup = assignment.coupons ? ` (+${assignment.coupons} куп.)` : '';
          const rsvp = assignment.rsvpStatus === 'confirmed' ? ' [✅ подтверждено]' : (assignment.rsvpStatus === 'declined' ? ' [❌ отказ]' : ' [⏳ ожидает RSVP]');
          statusLine = `🎯 <b>Вам назначено Место #${place}</b>${coup}${rsvp}`;
        } else if (registration) {
          const desPlace = registration.desiredPlace ? `#${registration.desiredPlace}` : 'любое';
          statusLine = `⏳ <i>Подана заявка (желаемое место: ${desPlace})</i>`;
        }
      }

      parts.push(`${idx + 1}. <b>${escapeHtml(title)}</b> (${dateStr})`);
      parts.push(`   ${statusLine}\n`);
    });

    return parts.join('\n').trim();
  }

  function getTelegramEventsKeyboard({ mode = 'upcoming' } = {}) {
    const keyboard = [];
    if (mode === 'past') {
      keyboard.push([
        { text: '◎ Предстоящие события', callback_data: 'cmd_events_upcoming' }
      ]);
    } else {
      keyboard.push([
        { text: '◌ Прошедшие события', callback_data: 'cmd_events_past' }
      ]);
    }
    keyboard.push([
      { text: '◀️ Главное меню', callback_data: 'cmd_menu' }
    ]);
    return { inline_keyboard: keyboard };
  }

  function getTelegramMainMenuKeyboard({ isStaff = false } = {}) {
    const keyboard = [
      [
        { text: '👤 Мой сектор', callback_data: 'cmd_me' },
        { text: '📊 Дефицит', callback_data: 'cmd_deficit' }
      ],
      [
        { text: '📅 Мои ивенты', callback_data: 'cmd_events' },
        { text: '📦 Обновить склад', callback_data: 'cmd_stock_help' }
      ]
    ];

    if (isStaff) {
      keyboard.push([
        { text: '📋 Сводка штаба', callback_data: 'cmd_digest' },
        { text: '⚠️ Должники', callback_data: 'cmd_stale' }
      ]);
    }

    return { inline_keyboard: keyboard };
  }

  function formatEventRegistrationKeyboard(eventId, places = null) {
    const eId = Number(eventId);
    const keyboard = [
      [
        { text: '🏆 Топ-1', callback_data: `reg_event:${eId}:1` },
        { text: '🥈 Топ-2', callback_data: `reg_event:${eId}:2` },
        { text: '🥉 Топ-3', callback_data: `reg_event:${eId}:3` }
      ],
      [
        { text: '🎖 Место 4–10', callback_data: `reg_event:${eId}:4` },
        { text: '🎲 Любое подходящее', callback_data: `reg_event:${eId}:0` }
      ]
    ];
    return { inline_keyboard: keyboard };
  }

  function formatEventRegistrationConfirmedKeyboard(eventId, desiredPlace) {
    const eId = Number(eventId);
    const placeNum = Number(desiredPlace);
    const placeLabel = placeNum > 0 ? `#${placeNum}` : 'Любое';
    const keyboard = [
      [
        { text: `✅ Заявка подана: Место ${placeLabel}`, callback_data: `noop_reg:${eId}` }
      ],
      [
        { text: '❌ Отозвать заявку', callback_data: `unreg_event:${eId}` }
      ]
    ];
    return { inline_keyboard: keyboard };
  }

  function formatTelegramWhoMessage({ player, user, freshness, recentEvents }) {
    const parts = [];
    const sectorName = player?.name || user?.username || 'Сектор';
    const rankMap = { r5: 'Р5', r4: 'Р4', r3: 'Р3', r2: 'Р2', r1: 'Р1' };
    const rankLabel = rankMap[(user?.rank || '').toLowerCase()] || (user?.rank || 'Р3').toUpperCase();
    const tgHandle = user?.username ? `@${user.username}` : (user?.telegram_chat_id ? `ID ${user.telegram_chat_id}` : 'не привязан');

    parts.push(`🪪 <b>Досье бойца:</b> <b>${escapeHtml(sectorName)}</b>`);
    parts.push(`👤 Владелец: <b>${escapeHtml(tgHandle)}</b> | Ранг: <b>${rankLabel}</b>`);

    const power = player?.power || 0;
    const powerFormatted = formatInputNumber(power);
    const vip = player?.vip !== undefined ? player.vip : (user?.vip !== undefined ? user.vip : '—');
    parts.push(`📊 Сила: <b>${powerFormatted}</b> | VIP: <b>${vip}</b>`);

    parts.push('\n📦 <b>Склад:</b>');
    const stock = player?.stock || {};
    const coupons = stock.coupons || 0;
    const puzzles = stock.puzzles || 0;
    parts.push(`• Купоны: <b>${formatInputNumber(coupons)}</b> 🎟️`);
    parts.push(`• Пазлы: <b>${formatInputNumber(puzzles)}</b> 🧩`);
    if (freshness) {
      const badgeIcon = freshness.status === 'fresh' ? '🟢' : (freshness.status === 'warning' ? '🟡' : '🔴');
      parts.push(`• Свежесть: ${badgeIcon} ${freshness.label || (freshness.days + ' дн. назад')}`);
    }

    if (recentEvents && recentEvents.length) {
      parts.push('\n📅 <b>Участие в ивентах:</b>');
      recentEvents.slice(0, 3).forEach(e => {
        const title = e.title || e.name || 'Ивент';
        const pl = e.actualPlace ? `#${e.actualPlace}` : (e.place ? `#${e.place} (план)` : '—');
        const coup = e.coupons ? ` (+${e.coupons} куп.)` : '';
        parts.push(`• ${escapeHtml(title)}: место ${pl}${coup}`);
      });
    }

    return parts.join('\n');
  }

  function formatTelegramStaleReport({ stalePlayers }) {
    const parts = [];
    parts.push('📋 <b>Отчет по устаревшим складам (>14 дн.):</b>\n');

    if (!stalePlayers || !stalePlayers.length) {
      parts.push('🟢 <b>Все склады альянса актуальны!</b> Устаревших данных нет.');
      return parts.join('\n');
    }

    stalePlayers.slice(0, 25).forEach((p, idx) => {
      const name = p.name || 'Сектор';
      const days = p.days !== undefined ? p.days : (p.freshness?.days || 14);
      const handle = p.username ? `@${p.username}` : (p.tgHandle || 'не привязан');
      parts.push(`${idx + 1}. <b>${escapeHtml(name)}</b> — ${days} дн. назад (${escapeHtml(handle)})`);
    });

    if (stalePlayers.length > 25) {
      parts.push(`\n<i>...и еще ${stalePlayers.length - 25} секторов.</i>`);
    }

    parts.push('\n💡 <i>Отправьте <code>/ping_stale</code> для автоматической рассылки персональных напоминаний должникам.</i>');
    return parts.join('\n');
  }

  function formatTelegramDigestMessage({ totalSectors = 0, freshnessStats = {}, nextEvent = null, pendingUsersCount = 0 }) {
    const parts = [];
    parts.push('📊 <b>Оперативная сводка альянса:</b>\n');
    parts.push(`👥 Всего активных секторов: <b>${totalSectors}</b>`);

    const fresh = freshnessStats.fresh || 0;
    const warning = freshnessStats.warning || 0;
    const stale = freshnessStats.stale || 0;
    parts.push(`📦 Актуальность складов:\n   🟢 Свежие: <b>${fresh}</b> | 🟡 Внимание: <b>${warning}</b> | 🔴 Устарели: <b>${stale}</b>`);

    if (nextEvent) {
      const eTitle = nextEvent.title || nextEvent.name || 'Событие';
      const eDate = nextEvent.dateStr || (nextEvent.dateFrom ? new Date(nextEvent.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—');
      const assigned = nextEvent.assignedCount !== undefined ? nextEvent.assignedCount : 0;
      const totalPl = nextEvent.totalPlaces !== undefined ? nextEvent.totalPlaces : 5;
      const regs = nextEvent.registrationsCount !== undefined ? nextEvent.registrationsCount : 0;
      parts.push(`\n📅 <b>Ближайший ивент:</b> <b>${escapeHtml(eTitle)}</b> (${eDate})`);
      parts.push(`   • Мест распределено: <b>${assigned}/${totalPl}</b>`);
      parts.push(`   • Подано заявок: <b>${regs}</b>`);
    } else {
      parts.push('\n📅 Ближайших запланированных событий нет.');
    }

    if (pendingUsersCount > 0) {
      parts.push(`\n🔔 <b>Новые бойцы на модерацию:</b> <b>${pendingUsersCount}</b> чел.`);
    }

    return parts.join('\n');
  }

  function formatTelegramOcrConfirmationMessage({ player, recognizedStock = {} }) {
    const parts = [];
    const sectorName = player?.name || 'Сектор';
    parts.push('📸 <b>Распознаны данные склада со скриншота:</b>');
    parts.push(`👤 Сектор: <b>${escapeHtml(sectorName)}</b>\n`);

    const coupons = Number(recognizedStock.coupons) || 0;
    const puzzles = Number(recognizedStock.puzzles) || 0;
    const starCoupons = Number(recognizedStock.starCoupons) || 0;
    const s1 = Number(recognizedStock.legendaryStars1) || 0;
    const s2 = Number(recognizedStock.legendaryStars2) || 0;
    const s3 = Number(recognizedStock.legendaryStars3) || 0;

    parts.push(`• Купоны: <b>${formatInputNumber(coupons)}</b>`);
    parts.push(`• Пазлы: <b>${formatInputNumber(puzzles)}</b>`);
    parts.push(`• Звездные купоны: <b>${formatInputNumber(starCoupons)}</b>`);
    parts.push(`• Звезды (I / II / III): <b>${s1} / ${s2} / ${s3}</b>\n`);
    parts.push('<i>Нажмите кнопку ниже, чтобы применить изменения, или скорректируйте их вручную.</i>');
    return parts.join('\n');
  }

  function getTelegramOcrConfirmationKeyboard(historyId) {
    return {
      inline_keyboard: [
        [
          { text: '✅ Применить изменения', callback_data: `confirm_ocr_stock:${historyId}` }
        ],
        [
          { text: '✏️ Ввести остатки /stock', callback_data: 'cmd_stock_help' }
        ]
      ]
    };
  }

  function getTelegramStockFallbackKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '✅ Текущие остатки актуальны', callback_data: 'confirm_current_stock' }
        ],
        [
          { text: '✏️ Ввести остатки /stock', callback_data: 'cmd_stock_help' }
        ]
      ]
    };
  }

  function validateTelegramWebAppData(initData, botToken, options = {}) {
    if (!initData || !botToken) {
      return { valid: false, error: 'missing_arguments' };
    }

    try {
      const cryptoModule = typeof require === 'function' ? require('node:crypto') : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoModule || typeof cryptoModule.createHmac !== 'function') {
        return { valid: false, error: 'crypto_not_supported' };
      }

      const params = new URLSearchParams(initData);
      const hash = params.get('hash');
      if (!hash) {
        return { valid: false, error: 'missing_hash' };
      }

      const authDate = Number(params.get('auth_date')) || 0;
      const nowSec = options.nowSec !== undefined ? options.nowSec : Math.floor(Date.now() / 1000);
      const maxAgeSec = options.maxAgeSec !== undefined ? options.maxAgeSec : 86400;

      if (maxAgeSec > 0) {
        if (!authDate || (nowSec - authDate) > maxAgeSec || (authDate - nowSec) > 300) {
          return { valid: false, error: 'expired' };
        }
      }

      const pairs = [];
      for (const [key, val] of params.entries()) {
        if (key !== 'hash') {
          pairs.push(`${key}=${val}`);
        }
      }
      pairs.sort();
      const dataCheckString = pairs.join('\n');

      const secretKey = cryptoModule.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const calculatedHash = cryptoModule.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      let hashesMatch = false;
      if (typeof cryptoModule.timingSafeEqual === 'function' && hash.length === 64 && calculatedHash.length === 64) {
        hashesMatch = cryptoModule.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'));
      } else {
        hashesMatch = (calculatedHash === hash);
      }

      if (!hashesMatch) {
        return { valid: false, error: 'invalid_hash' };
      }

      let user = null;
      const userRaw = params.get('user');
      if (userRaw) {
        try {
          user = JSON.parse(userRaw);
        } catch (_) {}
      }

      return {
        valid: true,
        user,
        authDate,
        queryId: params.get('query_id') || null
      };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  return {
    COUPON_PER_PUZZLE,
    PUZZLES_PER_LEVEL,
    MAX_LEVEL,
    STOCK_ZERO,
    INVESTED_ZERO,
    calculateRetrospectiveOfficerStock,
    normalizeInvested,
    sortOfficersByGeneration,
    STAR_COSTS,
    STAR_CUMULATIVE_COSTS,
    DEFAULT_OFFICERS,
    COMMUNITY_OFFICERS,
    VIP_TIERS_DATA,
    SKILL_UPGRADE_COSTS,
    SKILL_PROGRESSION_COSTS,
    formatInputNumber,
    parseInputNumber,
    calculateStarStockDelta,
    calculateSkillStockDelta,
    calculateLevelStockDelta,
    OFFICER_PAIRINGS,
    EVENT_PRESETS,
    OFFICER_TYPES,
    migrateState,
    dailyRewards,
    calculateVipDeficit,
    calculateSkillMedalsProgress,
    getRecommendedPairings,
    generateSeasonSchedule,
    forecastOfficer,
    forecastOfficerVariants,
    resolveEventPlaces,
    officerUsage,
    canDeleteOfficer,
    canR3SubmitResult,
    starCostFor,
    formatOfficerStarHint,
    validateImportData,
    buildAutoPick,
    calculateOfficerDeficit,
    simulateEventProgress,
    extractSectorCalendarEvents,
    simulateCalendarEventProgress,
    smartAutoPick,
    smartAutoPickWithRegistrations,
    isOfflineMutationAllowed,
    findActiveSector,
    formatSectorTitle,
    createOutboxItem,
    addToOutboxQueue,
    filterOutboxQueue,
    STAR_ITEM_VALUES,
    calculateTotalStarPoints,
    cleanOcrNumber,
    parseProfileScreenshotText,
    parseWarehouseScreenshotText,
    mergeScanResults,
    normalizeStock,
    OFFICER_TYPES,
    calculateTotalMedals,
    parseExchangeShopScreenshotText,
    calculateDurationDays,
    formatDayRange,
    filterPlayersByOfficers,
    prioritizeFilteredOfficers,
    isOfficerEligibleForSimulator,
    getSimulatorEligibleOfficers,
    USER_PERMISSIONS,
    PERMISSION_PRESETS,
    hasUserPermission,
    applyPermissionPreset,
    calculateStockDiff,
    getStockFreshness,
    DEFAULT_NOTIFICATION_TEMPLATES,
    NOTIFICATION_TEMPLATE_SAMPLE_DATA,
    renderTemplate,
    DEFAULT_STALE_ALERT_SCHEDULE,
    getZonedDateParts,
    shouldRunStaleStockAlert,
    calculateNextStaleRun,
    shouldSendMorningEventReminder,
    formatTimezoneOffsetLabel,
    getUserTimezoneInfo,
    convertTimeBetweenTimezones,
    calculateInitialOfficerStockDeduction,
    calculateOfficerStockReset,
    normalizeOfficerMode,
    getOfficerModeFromStore,
    setOfficerModeInStore,
    REFERENCE_GENERATION_COSTS,
    suggestOfficerPuzzleCost,
    collectUniqueOfficers,
    filterOfficersByQuery,
    getHashForRoute,
    parseRouteFromHash,
    parseTelegramStockCommand,
    formatStockUpdateSuccessMessage,
    formatRelativeTime,
    formatTelegramMeMessage,
    formatTelegramDeficitMessage,
    formatTelegramEventsListMessage,
    getTelegramEventsKeyboard,
    getTelegramMainMenuKeyboard,
    formatEventRegistrationKeyboard,
    formatEventRegistrationConfirmedKeyboard,
    formatTelegramWhoMessage,
    formatTelegramStaleReport,
    formatTelegramDigestMessage,
    formatTelegramOcrConfirmationMessage,
    getTelegramOcrConfirmationKeyboard,
    getTelegramStockFallbackKeyboard,
    validateTelegramWebAppData,
    escapeHtml,
  };
});
