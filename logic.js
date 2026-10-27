(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root, factory());
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COUPON_PER_PUZZLE = 500;
  const PUZZLES_PER_LEVEL = 5;
  const MAX_LEVEL = 180;
  const STAR_COSTS = [500, 1000, 6500, 25000, 65000, 98000];
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
  const OFFICER_TYPES = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

  const DEFAULT_OFFICERS = [
    { id: 'admiral-nathon', name: 'Адмирал Нейтон', type: 'Пехота', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'general-rex', name: 'Генерал Рекс', type: 'Танк', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'captain-black', name: 'Капитан Блэк', type: 'ПТ-Сау', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
  ];

  const COMMUNITY_OFFICERS = [
    { id: 'admiral-nathon', name: 'Адмирал Нейтон', type: 'Пехота', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'general-rex', name: 'Генерал Рекс', type: 'Танк', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'captain-black', name: 'Капитан Блэк', type: 'ПТ-Сау', generation: 7, couponPerPuzzle: 600, starCouponCost: 300, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'aurora', name: 'Аврора', type: 'Горнизон', generation: 8, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'valkyrie', name: 'Валькирия', type: 'Осада', generation: 9, couponPerPuzzle: 720, starCouponCost: 360, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'angel', name: 'Ангел', type: 'Танк', generation: 2, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'halina', name: 'Халина', type: 'ПТ-Сау', generation: 2, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'betty', name: 'Бетти', type: 'Пехота', generation: 3, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'eva', name: 'Ева', type: 'Танк', generation: 2, couponPerPuzzle: 500, starCouponCost: 250, upgradeType: 'standard', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'grace', name: 'Грейс', type: 'Танк', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'jessica', name: 'Джессика', type: 'Танк', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
    { id: 'marjorie', name: 'Марджори', type: 'Пехота', generation: 1, couponPerPuzzle: 0, starCouponCost: 0, upgradeType: 'special', medalsBeforeTraining: 480, medalsTraining: 900, medalsTotal: 1380 },
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
    { level: 18, points: 2200000, dailyPuzzles: 5 },
    { level: 19, points: 2800000, dailyPuzzles: 5 },
    { level: 20, points: 3500000, dailyPuzzles: 6 },
    { level: 21, points: 4300000, dailyPuzzles: 6 },
    { level: 22, points: 5200000, dailyPuzzles: 7 },
    { level: 23, points: 6200000, dailyPuzzles: 7 },
    { level: 24, points: 7300000, dailyPuzzles: 8 },
    { level: 25, points: 8500000, dailyPuzzles: 8 },
    { level: 26, points: 10000000, dailyPuzzles: 9 },
    { level: 27, points: 12000000, dailyPuzzles: 9 },
    { level: 28, points: 15000000, dailyPuzzles: 10 },
    { level: 29, points: 19000000, dailyPuzzles: 10 },
    { level: 30, points: 24000000, dailyPuzzles: 12 },
  ];

  const SKILL_UPGRADE_COSTS = [
    [10, 20, 30, 40], // Навык 1: 100 медалей
    [20, 40, 60, 80], // Навык 2: 200 медалей
    [30, 50, 70, 90], // Навык 3: 240 медалей
    [10, 30, 50, 60], // Навык 4: 150 медалей
  ];

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

    const isProfile = Boolean(sector.power || sector.kills || sector.killPoints || sector.name || sector.allianceTag);
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
      pattern: /Легендарная\s+звезда\s*(?:III|iii|3|Ⅲ|ІІІ)\b/i,
    },
    {
      key: 'legendaryStars2',
      pattern: /Легендарная\s+звезда\s*(?:II|ii|2|Ⅱ|ІІ)\b/i,
    },
    {
      key: 'legendaryStars1',
      pattern: /Легендарная\s+звезда\s*(?:I|i|1|Ⅰ|І)\b/i,
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

      const countMatch = windowText.match(/(?:В\s*на[лп]ичи[ие]?|На[лп]ичи[ие]?)\s*[:：]?\s*([0-9OoLlI.,\s']+)/i);
      if (countMatch) {
        const val = cleanOcrNumber(countMatch[1]);
        stock[def.key] = val;
      } else {
        const numMatches = windowText.matchAll(/(?:^|[^\d])([0-9OoLlI.,\s']{2,})/g);
        for (const nm of numMatches) {
          const candidate = cleanOcrNumber(nm[1]);
          if (candidate > 0 && candidate !== 110 && candidate !== 420 && candidate !== 960) {
            stock[def.key] = candidate;
            break;
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
            medalsBeforeTraining: 480,
            medalsTraining: 900,
            medalsTotal: 1380,
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
          stars: Math.max(0, Math.min(6, Number(officer.stars) || 0)),
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
    return STAR_COSTS[Math.max(1, Math.min(6, Number(stars) || 1)) - 1];
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

  function calculateSkillMedalsProgress(skills = [1, 1, 1, 1]) {
    const arr = Array.isArray(skills) ? skills : [1, 1, 1, 1];
    const normalized = [
      Math.max(1, Math.min(5, Number(arr[0]) || 1)),
      Math.max(1, Math.min(5, Number(arr[1]) || 1)),
      Math.max(1, Math.min(5, Number(arr[2]) || 1)),
      Math.max(1, Math.min(5, Number(arr[3]) || 1)),
    ];

    let spentMedals = 0;
    for (let i = 0; i < 4; i++) {
      const lvl = normalized[i];
      for (let step = 0; step < lvl - 1; step++) {
        spentMedals += SKILL_UPGRADE_COSTS[i][step] || 0;
      }
    }

    const remainingMedals = Math.max(0, 690 - spentMedals);
    const isMaxSkills = spentMedals === 690 && normalized.every(lvl => lvl === 5);

    return {
      spentMedals,
      remainingMedals,
      isMaxSkills,
      skills: normalized,
    };
  }

  function getRecommendedPairings(officerId) {
    if (!officerId) return [];
    return OFFICER_PAIRINGS[String(officerId)] || [];
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
        const durationDays = Math.max(1, Number(rule.durationDays) || 1);

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
    const rawCost = Number(catalogItem?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0 ? 0 : (rawCost || COUPON_PER_PUZZLE);
    const target = Math.max(1, Math.min(MAX_LEVEL, Number(targetLevel) || MAX_LEVEL));
    const targetPuzzles = target * PUZZLES_PER_LEVEL;

    const officerCoupons = Math.max(0, Number(officer?.coupons) || 0);
    const officerLevel = Math.max(0, Number(officer?.level) || 0);
    const currentPuzzles = officerLevel * PUZZLES_PER_LEVEL + (costPerPuzzle > 0 ? Math.floor(officerCoupons / costPerPuzzle) : 0);

    let stockPuzzles = 0;
    if (includeStock) {
      const stockPuzzlesVal = Math.max(0, Number(player?.stock?.puzzles) || 0);
      const stockCouponsVal = Math.max(0, Number(player?.stock?.coupons) || 0);
      stockPuzzles = stockPuzzlesVal + (costPerPuzzle > 0 ? Math.floor(stockCouponsVal / costPerPuzzle) : 0);
    }

    const deficitPuzzles = Math.max(0, targetPuzzles - currentPuzzles - stockPuzzles);
    const deficitCoupons = costPerPuzzle > 0 ? deficitPuzzles * costPerPuzzle : 0;

    const daily = dailyRewards(player?.sector);
    const dailyIncome = daily.puzzlesPerDay;

    const daysWithoutEvents = deficitPuzzles === 0
      ? 0
      : (dailyIncome > 0 ? Math.ceil(deficitPuzzles / dailyIncome) : null);

    const baseToday = today || new Date().toISOString().slice(0, 10);
    const dateWithoutEvents = daysWithoutEvents !== null ? dateAdd(baseToday, daysWithoutEvents) : null;

    const currentStars = Math.max(0, Math.min(6, Number(officer?.stars) || 0));
    const requiredStars = 6;
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
      candidateList = candidates.map(c => ({
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

  return {
    COUPON_PER_PUZZLE,
    PUZZLES_PER_LEVEL,
    MAX_LEVEL,
    STOCK_ZERO,
    STAR_COSTS,
    DEFAULT_OFFICERS,
    COMMUNITY_OFFICERS,
    VIP_TIERS_DATA,
    SKILL_UPGRADE_COSTS,
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
    validateImportData,
    buildAutoPick,
    calculateOfficerDeficit,
    simulateEventProgress,
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
  };
});
