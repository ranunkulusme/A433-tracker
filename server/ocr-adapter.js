/**
 * KoW Tracker - Deep Module: Server OCR Adapter & Screenshot Parsing
 *
 * Encapsulates native Tesseract + ImageMagick column cropping and all
 * game screenshot text parsers (profile, warehouse, exchange shop) behind
 * a single clean seam. Eliminates cross-module protocol markers and duplicated
 * browser Tesseract code.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

function cleanOcrNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  }
  if (!raw || typeof raw !== 'string') return 0;

  let s = raw.trim();
  if (!s || !/\d/.test(s)) return 0;

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
    .replace(/(\d[,.'\s]?)[Oo]$/g, '$10')
    .replace(/(\d)[)\]|!](?:\D|$)/g, '$11');

  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const APP_UI_SCREENSHOT_RE = /(?:Smart\s*Scanner|Запасы\s*склада|Статистика\s*персонажа|Распознано\s*параметров|Успешно\s*обработано\s*скриншотов|Или\s+вставьте\s+изображение)/i;

function parseProfileScreenshotText(text) {
  if (!text || typeof text !== 'string') {
    return { isProfile: false, sector: {}, recognizedFields: [] };
  }
  if (APP_UI_SCREENSHOT_RE.test(text)) {
    return { isProfile: false, sector: {}, recognizedFields: [] };
  }

  const sector = {};
  const recognizedFields = [];

  const tagMatch = text.match(/\[([A-Za-zА-Яа-яЁё0-9_#]{2,12})\]\s*([^\r\n,;:()]{1,35})/);
  if (tagMatch) {
    sector.allianceTag = tagMatch[1].trim();
    sector.name = tagMatch[2].trim();
    recognizedFields.push('allianceTag', 'name');
  } else {
    const nameMatch = text.match(/(?:Ник(?:нейм)?|Имя|Командир|Commander|Name|Kommandant)\s*[:：]?\s*([^\r\n,;:()]{1,35})/i);
    if (nameMatch) {
      const rawName = nameMatch[1].trim();
      const innerTag = rawName.match(/^\[([A-Za-zА-Яа-яЁё0-9_#]+)\]\s*(.*)$/);
      if (innerTag) {
        sector.allianceTag = innerTag[1].trim();
        sector.name = innerTag[2].trim();
        recognizedFields.push('allianceTag', 'name');
      } else {
        sector.name = rawName;
        recognizedFields.push('name');
      }
    }
  }

  const NUMBER_PATTERN = '(?:[0-9OoLlI]{1,3}(?:[ \\t][0-9OoLlI]{3})+|[0-9OoLlI]+(?:[.,\\x27][0-9OoLlI]{3})+|[0-9OoLlI]+(?:[.,][0-9OoLlI]+)?)(?:[^\\S\\r\\n]*[KkMmBb](?=[^A-Za-z]|$))?';

  const powerRegex = new RegExp(`(?:[СсCcSsПп]?[иеыu][лпд][аa]|[Ппл][аa]|[HНнn][aа]|Мощь|Power|Macht|Kraft)(?!\\s*(?:юнит\\S*|постро\\S*|исслед\\S*|офицер\\S*|военн\\S*|корабл\\S*|unit\\S*|build\\S*|research|hero|officer|ship))[\\s|:：-]*(?:([0-9OoLlI]{1,3}(?:[\\s.,'’\\x27]+[0-9OoLlI]{2,3}){1,3})|(${NUMBER_PATTERN}))`, 'gi');
  let bestPower = 0;
  let pMatch;
  while ((pMatch = powerRegex.exec(text)) !== null) {
    const pVal = cleanOcrNumber(pMatch[1] || pMatch[2]);
    if (pVal > bestPower) bestPower = pVal;
  }

  const killsRegex = new RegExp(`(?:Уничтожено(?:\\s+юнитов|\\s+войск)?|Убито|[УуYy]?бит[оаы]?|[Тт]о\\b|(?<=[^A-Za-zА-Яа-яЁё0-9]|^)[ТтTt](?=[^A-Za-zА-Яа-яЁё0-9]|$)|Kills|Eliminierungen|Getötet|Besiegt)[^\\S\\r\\n]*[:：|]?[^\\S\\r\\n]*(${NUMBER_PATTERN})`, 'i');
  const killsMatch = text.match(killsRegex);
  let killsVal = 0;
  if (killsMatch) {
    killsVal = cleanOcrNumber(killsMatch[1]);
    if (killsVal > 0) {
      sector.kills = killsVal;
      recognizedFields.push('kills');
    }
  }

  if (!bestPower || bestPower < 1000000) {
    const subPowerRegex = new RegExp(`(?:[СсCcSs]?ила|Мощь|[Ппл][аa]|[HНнn][aа])\\s*(?:юнит\\S*|постро\\S*|исслед\\S*|офицер\\S*|военн\\S*\\s*корабл\\S*)[^\\S\\r\\n]*[:：|]?[^\\S\\r\\n]*(${NUMBER_PATTERN})`, 'gi');
    let subSum = 0;
    let spMatch;
    while ((spMatch = subPowerRegex.exec(text)) !== null) {
      subSum += cleanOcrNumber(spMatch[1]);
    }
    if (subSum > bestPower) bestPower = subSum;
  }

  if (killsMatch && killsMatch.index !== undefined && (!bestPower || bestPower < 5000000)) {
    const headerTextBeforeKills = text.slice(Math.max(0, killsMatch.index - 200), killsMatch.index);
    const largeNumMatches = headerTextBeforeKills.matchAll(new RegExp(`(${NUMBER_PATTERN})`, 'g'));
    for (const lm of largeNumMatches) {
      const candidate = cleanOcrNumber(lm[1]);
      if (candidate > 5000000 && candidate < 2000000000 && candidate !== killsVal && candidate > bestPower) {
        bestPower = candidate;
      }
    }
  }

  if (bestPower > 0) {
    sector.power = bestPower;
    recognizedFields.push('power');
  }

  const kpRegex = new RegExp(`(?:Очки\\s+(?:за\\s+)?убийств[ао]?|Kill\\s*Points?|Tötungspunkte|Eliminierungspunkte)[^\\S\\r\\n]*[:：]?[^\\S\\r\\n]*(${NUMBER_PATTERN})`, 'gi');
  let exactKp = 0;
  let roundedKp = 0;
  let match;
  while ((match = kpRegex.exec(text)) !== null) {
    const rawVal = match[1].trim();
    const isSuffix = /[KkMmBb]$/i.test(rawVal);
    const cleaned = cleanOcrNumber(rawVal);
    if (cleaned > 0) {
      if (!isSuffix && cleaned > 1000) {
        if (cleaned > exactKp) exactKp = cleaned;
      } else if (!roundedKp) {
        roundedKp = cleaned;
      }
    }
  }

  let finalKp = exactKp;
  if (roundedKp > 0) {
    if (exactKp > 0) {
      const ratio = exactKp / roundedKp;
      if (ratio < 0.2 || ratio > 5.0) finalKp = roundedKp;
    } else {
      finalKp = roundedKp;
    }
  }

  if (finalKp > 0) {
    sector.killPoints = finalKp;
    recognizedFields.push('killPoints');
  }

  const hasStats = Boolean(sector.power || sector.kills || sector.killPoints);
  const hasWarehouseMarkers = /(?:[ВB8]?\s*[HНнh][аa][лпдnu]+[иеыкum]+|предмет|звезд|опыт|купон\s+готовност|медал[ья]\s+легендарн|officer\s+readiness|in\s*stock|vorhanden|im\s*besitz)/i.test(text);

  if (hasWarehouseMarkers && !hasStats) {
    return { isProfile: false, sector: {}, recognizedFields: [] };
  }

  const isProfile = Boolean(hasStats || sector.name || sector.allianceTag);
  return { isProfile, sector, recognizedFields };
}

const WAREHOUSE_ITEM_DEFINITIONS = [
  {
    key: 'coupons',
    pattern: /(?:Купон\s+готовности[^\w\n\r]*\s*офицер\S*|Купон\s+готовности\S*\s*офицер\S*|Officer\s+Readiness\s+Coupon|Offiziersbereitschafts-Gutschein|Offiziersgutschein)/i,
  },
  {
    key: 'chests',
    pattern: /(?:(?:Сундук(?!\s*(?:выбор|broce))|ee)[^\n]{0,35}(?:медал\S*|[ЭэEe]еда\S*)[^\n]{0,35}(?:офицер\S*)?|(?:Сундук(?!\s*(?:выбор|broce))[^\n]{0,35})?(?:медалей|[ЭэEe]еда\S*)[\s\S]{0,35}?офицера|Legendary\s+Officer\s+Medal\s+Chest|Offiziersmedaillen-Truhe|Truhe\s+mit\s+Offiziersmedaillen)/i,
    validator: (text, matchIndex) => {
      const windowAround = text.slice(Math.max(0, matchIndex - 30), matchIndex + 40);
      return !/(?:выбор|broce|choice|auswahl)/i.test(windowAround);
    }
  },
  {
    key: 'puzzles',
    pattern: /(?:(?:[МмM]едал\S*\s*)?[‘\x27"`]?легендарн\S*(?:[^\n]{0,25}\n)?[^\n]{0,20}?офицер\S*|[МмM]едал\S*\s+легендарн\S*|Legendary\s+Officer\s+Medal|Legendäre\s+Offiziersmedaille)/i,
    validator: (text, matchIndex) => {
      const before = text.slice(Math.max(0, matchIndex - 40), matchIndex);
      if (/(?:сундук|выбор|chest|truhe)/i.test(before)) return false;
      const matchSegment = text.slice(matchIndex, matchIndex + 35);
      if (/(?:звезд|star|stern)/i.test(matchSegment)) return false;
      return true;
    }
  },
  {
    key: 'starCoupons',
    pattern: /(?:Купон\s+готовности[^\w\n\r]*\s*звезд[ыае]?|Star\s+Readiness\s+Coupon|Sternbereitschafts-Gutschein|Sterngutschein|(?:Купон\s+готовности[^\n]{0,35}\n[^\n]{0,35}звезд[ыае]?))/i,
  },
  {
    key: 'legendaryStars3',
    pattern: /(?:960[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+|Legendary|Legendäre[rs]?)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27"`]?(?:звезд[аы]|Star|Stern)\s*[‘'\x27"`]?(?:III|iii|3|Ⅲ|ІІІ|Ш|ш|111|\|\|\||lll|\|I\|)(?=[^A-Za-zА-Яа-яЁё0-9]|$)|960[^\S\r\n]+(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}звезд[аы]|(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}звезд[аы][^\r\n]{0,15}\n[^\S\r\n]*960|960[^\S\r\n]+звезд[аы]/i,
  },
  {
    key: 'legendaryStars2',
    pattern: /(?:420[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+|Legendary|Legendäre[rs]?)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27"`]?(?:звезд[аы]|Star|Stern)\s*[‘'\x27"`]?(?:II|ii|2|Ⅱ|ІІ|П|п|11|\|\||ll)(?=[^A-Za-zА-Яа-яЁё0-9]|$)|420[^\S\r\n]+(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}звезд[аы]|(?:Легендарн[а-я]+|Пегендарн[а-я]+)[^\r\n]{0,25}звезд[аы][^\r\n]{0,15}\n[^\S\r\n]*420|420[^\S\r\n]+звезд[аы]/i,
  },
  {
    key: 'legendaryStars1',
    pattern: /(?:(?:Медаль[^\S\r\n]+Звезд[аы]|110[^\w\n]*\n?)?(?:Легендарн[а-я]+|Пегендарн[а-я]+|Legendary|Legendäre[rs]?)[^\r\n]{0,25}(?:\r?\n[^\r\n]{0,15})?[‘'\x27"`]?(?:звезд[аы]|Star|Stern)\s*[‘'\x27"`]?(?:I|i|1|Ⅰ|І|l|\||!)(?=[^A-Za-zА-Яа-яЁё0-9]|$)|Медаль[^\S\r\n]+Звезд[аы]|110[^\S\r\n]+(?:Легендарн[а-я]+|Медаль)[^\r\n]{0,25}звезд[аы]|110[^\S\r\n]+звезд[аы])/i,
  },
];

function extractStockFromTextSlice(text) {
  if (!text || typeof text !== 'string') return {};
  const stock = {};

  for (const def of WAREHOUSE_ITEM_DEFINITIONS) {
    const regex = new RegExp(def.pattern.source, def.pattern.flags.includes('g') ? def.pattern.flags : def.pattern.flags + 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (def.validator && !def.validator(text, match.index)) continue;

      const startIndex = match.index + match[0].length;
      const windowText = text.slice(startIndex, startIndex + 250);
      const countMatch = windowText.match(/(?:[ВB8]?\s*(?:[HНнh][аa][лпдnu]+[иеыкum]+|на[лпд]ич[^\s\d:：;.]*|aman|aлuu|In\s*Stock|Owned|Available|Amount|Vorhanden|Im\s*Besitz|Bestand)[^\S\r\n]*[:：;.]?)\s*(?:[6°oO]\s+)?([0-9OoLlI][0-9OoLlI., \t\x27\)]*)/i);
      if (countMatch) {
        const val = cleanOcrNumber(countMatch[1]);
        if (val > 0) {
          stock[def.key] = val;
          break;
        }
      } else {
        const lineMatches = windowText.split(/\r?\n/).slice(0, 5);
        let fallbackCandidate = 0;
        for (const line of lineMatches) {
          const numMatch = line.match(/(?:^|[^\d])([0-9OoLlI][0-9OoLlI., \t\x27\)]+)/);
          if (numMatch) {
            const candidate = cleanOcrNumber(numMatch[1]);
            if (candidate > 0 && candidate !== 110 && candidate !== 420 && candidate !== 960) {
              if (candidate === 1) {
                if (!fallbackCandidate) fallbackCandidate = 1;
              } else {
                fallbackCandidate = candidate;
                break;
              }
            }
          }
        }
        if (fallbackCandidate > 0) {
          stock[def.key] = fallbackCandidate;
          break;
        }
      }
    }
  }
  return stock;
}

/**
 * Parse warehouse text or structured left/right column texts cleanly.
 */
function parseWarehouseScreenshotText(input) {
  if (!input) {
    return { isWarehouse: false, stock: {}, recognizedFields: [] };
  }

  let fullText = '';
  let leftText = '';
  let rightText = '';

  if (typeof input === 'object' && !Array.isArray(input)) {
    fullText = String(input.fullText || input.text || '');
    leftText = String(input.leftText || '');
    rightText = String(input.rightText || '');
    if (!fullText && (leftText || rightText)) {
      fullText = `${leftText}\n${rightText}`.trim();
    }
  } else if (typeof input === 'string') {
    fullText = input;
  } else {
    return { isWarehouse: false, stock: {}, recognizedFields: [] };
  }

  if (APP_UI_SCREENSHOT_RE.test(fullText)) {
    return { isWarehouse: false, stock: {}, recognizedFields: [] };
  }

  let stock = {};
  if (leftText || rightText) {
    stock = {
      ...extractStockFromTextSlice(leftText),
      ...extractStockFromTextSlice(rightText)
    };
    const fullStock = extractStockFromTextSlice(fullText);
    for (const [k, v] of Object.entries(fullStock)) {
      if (stock[k] === undefined && v !== undefined) {
        stock[k] = v;
      }
    }
  } else {
    stock = extractStockFromTextSlice(fullText);
  }

  const recognizedFields = Object.keys(stock).filter(k => typeof stock[k] === 'number');
  return { isWarehouse: recognizedFields.length > 0, stock, recognizedFields };
}

function parseExchangeShopScreenshotText(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
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

      const starMatch = windowText.match(/110\s*[xXхХ*]?\s*1?\s*(\d{3,4})/);
      if (starMatch) starCouponCost = parseInt(starMatch[1], 10);

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

function classifyScreenshotText(input) {
  const fullText = typeof input === 'object' ? String(input?.fullText || input?.text || `${input?.leftText || ''}\n${input?.rightText || ''}`) : String(input || '');
  if (!fullText.trim()) return 'unknown';
  if (APP_UI_SCREENSHOT_RE.test(fullText)) return 'app_ui';

  const whParsed = parseWarehouseScreenshotText(input);
  if (whParsed && whParsed.isWarehouse) return 'warehouse';
  const profParsed = parseProfileScreenshotText(fullText);
  if (profParsed && profParsed.isProfile) return 'profile';
  const shopParsed = parseExchangeShopScreenshotText(fullText);
  if (shopParsed && shopParsed.length > 0) return 'exchange_shop';
  return 'unknown';
}

function parseSmartScanText(input) {
  const fullText = typeof input === 'object'
    ? String(input?.fullText || input?.text || `${input?.leftText || ''}\n${input?.rightText || ''}`)
    : String(input || '');

  if (!fullText.trim()) {
    return {
      detectedType: 'unknown',
      hasRecognizedData: false,
      isWarehouse: false,
      isProfile: false,
      isExchangeShop: false,
      sector: {},
      stock: {},
      officers: [],
      recognizedFields: [],
      rawText: fullText,
    };
  }

  const detectedType = classifyScreenshotText(input);
  if (detectedType === 'app_ui') {
    return {
      detectedType: 'app_ui',
      hasRecognizedData: false,
      isWarehouse: false,
      isProfile: false,
      isExchangeShop: false,
      sector: {},
      stock: {},
      officers: [],
      recognizedFields: [],
      rawText: fullText,
    };
  }

  const profParsed = parseProfileScreenshotText(fullText);
  const whParsed = parseWarehouseScreenshotText(input);
  const shopParsed = parseExchangeShopScreenshotText(fullText);

  const isWarehouse = whParsed.isWarehouse;
  const isProfile = isWarehouse ? false : profParsed.isProfile;
  const isExchangeShop = (!isWarehouse && !isProfile) && (detectedType === 'exchange_shop');

  const sector = isProfile ? profParsed.sector : {};
  const stock = whParsed.stock || {};
  const officers = isExchangeShop ? shopParsed : [];

  const recognizedFields = [];
  if (isWarehouse && whParsed.recognizedFields) recognizedFields.push(...whParsed.recognizedFields);
  if (isProfile && profParsed.recognizedFields) recognizedFields.push(...profParsed.recognizedFields);
  if (isExchangeShop && officers.length > 0) recognizedFields.push('exchange_shop_officers');

  return {
    detectedType,
    hasRecognizedData: recognizedFields.length > 0,
    isWarehouse,
    isProfile,
    isExchangeShop,
    sector,
    stock,
    officers,
    recognizedFields,
    rawText: fullText,
  };
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
      if (val === 0 && mergedSector[key]) continue;
      if (key === 'killPoints') {
        const currentKp = mergedSector.killPoints || 0;
        if (!currentKp) {
          mergedSector.killPoints = val;
        } else {
          const isCurrentRounded = currentKp % 100000 === 0;
          const isNewRounded = val > 0 && val % 100000 === 0;
          if (isCurrentRounded && !isNewRounded) mergedSector.killPoints = val;
          else if (!isCurrentRounded && isNewRounded) { /* keep current exact */ }
          else mergedSector.killPoints = val;
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
      if (val > 0 || mergedStock[key] === undefined) mergedStock[key] = val;
    } else {
      mergedStock[key] = val;
    }
  }

  return { sector: mergedSector, stock: mergedStock };
}

function hasAnyStockValue(stock) {
  if (!stock || typeof stock !== 'object') return false;
  return Object.values(stock).some(v => typeof v === 'number' && v > 0);
}

function detectImageExtension(imageBuffer) {
  if (imageBuffer && imageBuffer.length >= 4) {
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8 && imageBuffer[2] === 0xFF) return '.jpg';
    if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) return '.png';
    if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) return '.webp';
  }
  return '.png';
}

function createOcrAdapter({ customRunner = null, execFileFn = execFile } = {}) {
  let activeRunner = customRunner;

  function setRunner(fn) {
    activeRunner = typeof fn === 'function' ? fn : null;
  }

  async function recognizeBuffer(imageBuffer, options = {}) {
    if (typeof activeRunner === 'function') {
      try {
        const res = await activeRunner(imageBuffer, options);
        if (res === null) return { success: false, error: 'ocr_null' };
        if (typeof res === 'string') return { success: true, text: res, fullText: res };
        if (res && (res.fullText || res.leftText || res.rightText)) {
          return {
            success: true,
            text: String(res.fullText || `${res.leftText || ''}\n${res.rightText || ''}`.trim()),
            fullText: String(res.fullText || ''),
            leftText: String(res.leftText || ''),
            rightText: String(res.rightText || ''),
            stock: res.stock
          };
        }
        if (res && typeof res.text === 'string') return { success: true, text: res.text, fullText: res.text, stock: res.stock };
        if (res && res.stock) return { success: true, text: '', fullText: '', stock: res.stock };
        if (res && (
          res.coupons !== undefined || res.puzzles !== undefined || res.starCoupons !== undefined ||
          res.chests !== undefined || res.legendaryStars1 !== undefined || res.legendaryStars2 !== undefined || res.legendaryStars3 !== undefined
        )) {
          return { success: true, text: '', fullText: '', stock: res };
        }
        if (res && typeof res === 'object') return { success: true, text: '', fullText: '', ...res };
        return { success: true, text: '', fullText: '' };
      } catch (err) {
        console.warn('[OCR] Custom OCR runner error:', err.message);
        return { success: false, error: 'ocr_error', message: err.message };
      }
    }

    const ext = detectImageExtension(imageBuffer);
    const tempPath = path.join(os.tmpdir(), `ocr_scan_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    const filesToCleanup = [tempPath];

    try {
      await fs.promises.writeFile(tempPath, imageBuffer);
      const ocrText = await new Promise((resolve, reject) => {
        execFileFn('tesseract', [tempPath, 'stdout', '-l', 'rus+eng+deu', '--oem', '1'], { timeout: 25000 }, (error, stdout) => {
          if (error) return reject(error);
          resolve(stdout || '');
        });
      });

      let leftText = '';
      let rightText = '';
      try {
        const leftPath = path.join(os.tmpdir(), `ocr_col_left_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        const rightPath = path.join(os.tmpdir(), `ocr_col_right_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        filesToCleanup.push(leftPath, rightPath);

        const magickBin = await new Promise(res => {
          execFileFn('which', ['magick'], (err, stdout) => {
            if (!err && stdout && stdout.trim()) return res('magick');
            execFileFn('which', ['convert'], (err2, stdout2) => {
              if (!err2 && stdout2 && stdout2.trim()) return res('convert');
              res(null);
            });
          });
        });

        if (magickBin) {
          await Promise.all([
            new Promise(resolveCrop => {
              execFileFn(magickBin, [tempPath, '-gravity', 'West', '-crop', '56%x100%+0+0', leftPath], { timeout: 10000 }, () => resolveCrop());
            }),
            new Promise(resolveCrop => {
              execFileFn(magickBin, [tempPath, '-gravity', 'East', '-crop', '56%x100%+0+0', rightPath], { timeout: 10000 }, () => resolveCrop());
            })
          ]);

          const [leftOcr, rightOcr] = await Promise.all([
            new Promise(resOcr => {
              execFileFn('tesseract', [leftPath, 'stdout', '-l', 'rus+eng+deu', '--oem', '1'], { timeout: 20000 }, (e, out) => resOcr(out || ''));
            }),
            new Promise(resOcr => {
              execFileFn('tesseract', [rightPath, 'stdout', '-l', 'rus+eng+deu', '--oem', '1'], { timeout: 20000 }, (e, out) => resOcr(out || ''));
            })
          ]);

          leftText = leftOcr || '';
          rightText = rightOcr || '';
        }
      } catch (_) {}

      return {
        success: true,
        text: ocrText || '',
        fullText: ocrText || '',
        leftText,
        rightText
      };
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.message?.includes('not found'))) {
        return { success: false, error: 'tesseract_not_installed', message: 'Tesseract OCR не установлен на сервере' };
      }
      return { success: false, error: 'ocr_failed', message: err.message || 'Ошибка распознавания текста' };
    } finally {
      for (const f of filesToCleanup) {
        fs.promises.unlink(f).catch(() => {});
      }
    }
  }

  async function recognizeStock(imageBufferOrPath) {
    let buf = imageBufferOrPath;
    if (typeof imageBufferOrPath === 'string') {
      try {
        buf = await fs.promises.readFile(imageBufferOrPath);
      } catch (_) {
        return null;
      }
    }
    const ocrRes = await recognizeBuffer(buf);
    if (!ocrRes || !ocrRes.success) return null;
    if (ocrRes.stock && hasAnyStockValue(ocrRes.stock)) return ocrRes.stock;

    const parsedStock = parseWarehouseScreenshotText({
      fullText: ocrRes.fullText || ocrRes.text || '',
      leftText: ocrRes.leftText || '',
      rightText: ocrRes.rightText || ''
    });
    if (parsedStock && hasAnyStockValue(parsedStock.stock)) {
      return parsedStock.stock;
    }
    return null;
  }

  async function scanImages(rawImages, { mode = 'smart' } = {}) {
    let accumulated = { sector: {}, stock: {} };
    const allRecognizedFields = [];
    const allRawTexts = [];
    const detectedTypes = [];
    const exchangeOfficers = [];
    let processedCount = 0;
    let lastError = null;

    for (const imgItem of rawImages || []) {
      let buf = null;
      if (typeof imgItem === 'string') {
        const match = imgItem.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
        const base64Str = match ? match[1] : imgItem;
        try {
          buf = Buffer.from(base64Str, 'base64');
        } catch (_) {
          continue;
        }
      } else if (Buffer.isBuffer(imgItem)) {
        buf = imgItem;
      }
      if (!buf || buf.length === 0) continue;

      const ocrRes = await recognizeBuffer(buf);
      if (!ocrRes.success) {
        lastError = ocrRes;
        continue;
      }

      const combinedText = [ocrRes.fullText || ocrRes.text || '', ocrRes.leftText || '', ocrRes.rightText || '']
        .filter(Boolean)
        .join('\n')
        .trim();
      if (combinedText) {
        allRawTexts.push(ocrRes.fullText || ocrRes.text || combinedText);
      }

      if (mode === 'exchange') {
        const parsedOfficers = Array.isArray(ocrRes.officers) && ocrRes.officers.length
          ? ocrRes.officers
          : parseExchangeShopScreenshotText(combinedText);
        for (const off of parsedOfficers) {
          if (off?.name && !exchangeOfficers.some(o => o.name.toLowerCase() === off.name.toLowerCase())) {
            exchangeOfficers.push(off);
          }
        }
        detectedTypes.push(parsedOfficers.length > 0 ? 'exchange_shop' : 'unknown');
        if (parsedOfficers.length > 0) allRecognizedFields.push('exchange_shop_officers');
        processedCount++;
        continue;
      }

      if (ocrRes.stock && Object.keys(ocrRes.stock).length > 0) {
        accumulated = mergeScanResults(accumulated, { isWarehouse: true, stock: ocrRes.stock });
        detectedTypes.push('warehouse');
        allRecognizedFields.push(...Object.keys(ocrRes.stock));
        processedCount++;
        continue;
      }

      const parsed = parseSmartScanText({
        fullText: ocrRes.fullText || ocrRes.text || '',
        leftText: ocrRes.leftText || '',
        rightText: ocrRes.rightText || ''
      });
      detectedTypes.push(parsed.detectedType);
      if (parsed.recognizedFields && parsed.recognizedFields.length > 0) {
        allRecognizedFields.push(...parsed.recognizedFields);
      }
      if (parsed.isExchangeShop && Array.isArray(parsed.officers)) {
        for (const off of parsed.officers) {
          if (off?.name && !exchangeOfficers.some(o => o.name.toLowerCase() === off.name.toLowerCase())) {
            exchangeOfficers.push(off);
          }
        }
      }

      accumulated = mergeScanResults(accumulated, {
        isProfile: parsed.isProfile,
        isWarehouse: parsed.isWarehouse,
        sector: parsed.sector || {},
        stock: parsed.stock || {},
      });
      processedCount++;
    }

    if (processedCount === 0 && lastError) {
      return {
        success: false,
        error: lastError.error || 'OCR_ERROR',
        message: lastError.message || 'Ошибка распознавания'
      };
    }

    const uniqueFields = Array.from(new Set(allRecognizedFields));
    const primaryType = detectedTypes.find(t => t !== 'unknown') || 'unknown';
    return {
      success: true,
      detectedType: primaryType,
      hasRecognizedData: uniqueFields.length > 0,
      sector: accumulated.sector || {},
      stock: accumulated.stock || {},
      officers: exchangeOfficers,
      recognizedFields: uniqueFields,
      imagesProcessed: processedCount,
      rawTexts: allRawTexts
    };
  }

  return {
    setRunner,
    recognizeBuffer,
    recognizeStock,
    scanImages
  };
}

module.exports = {
  createOcrAdapter,
  cleanOcrNumber,
  parseProfileScreenshotText,
  parseWarehouseScreenshotText,
  classifyScreenshotText,
  parseSmartScanText,
  mergeScanResults,
  parseExchangeShopScreenshotText,
  hasAnyStockValue
};
