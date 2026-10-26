/**
 * KoW Tracker - Smart Scanner (OCR Engine & Preprocessor)
 * Клиентский модуль распознавания скриншотов профиля и склада
 * на базе Tesseract.js Web Worker и Canvas-предобработки.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const logicModule = typeof require !== 'undefined' ? require('./logic.js') : null;
    module.exports = factory(logicModule);
  } else {
    root.smartScanner = factory(root.logic || (typeof globalThis !== 'undefined' ? globalThis.logic : null));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (injectedLogic) {
  'use strict';

  const TESSERACT_CDN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  let tesseractLoadingPromise = null;
  let activeWorkerInstance = null;
  let workerInitializationPromise = null;

  /**
   * Разрешение модуля бизнес-логики (logic.js)
   */
  function resolveLogic(customLogic) {
    if (customLogic && typeof customLogic.parseProfileScreenshotText === 'function') {
      return customLogic;
    }
    if (injectedLogic && typeof injectedLogic.parseProfileScreenshotText === 'function') {
      return injectedLogic;
    }
    if (typeof globalThis !== 'undefined' && globalThis.logic && typeof globalThis.logic.parseProfileScreenshotText === 'function') {
      return globalThis.logic;
    }
    if (typeof window !== 'undefined' && window.logic && typeof window.logic.parseProfileScreenshotText === 'function') {
      return window.logic;
    }
    if (typeof require !== 'undefined') {
      try {
        const mod = require('./logic.js');
        if (mod && typeof mod.parseProfileScreenshotText === 'function') {
          return mod;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Динамическая загрузка Tesseract.js через CDN при отсутствии в глобальной области
   */
  function loadTesseract() {
    if (typeof globalThis !== 'undefined' && globalThis.Tesseract) {
      return Promise.resolve(globalThis.Tesseract);
    }
    if (typeof window !== 'undefined' && window.Tesseract) {
      return Promise.resolve(window.Tesseract);
    }
    if (tesseractLoadingPromise) {
      return tesseractLoadingPromise;
    }

    if (typeof document !== 'undefined') {
      tesseractLoadingPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${TESSERACT_CDN_URL}"]`);
        if (existing) {
          if (globalThis.Tesseract || window.Tesseract) {
            return resolve(globalThis.Tesseract || window.Tesseract);
          }
          existing.addEventListener('load', () => resolve(globalThis.Tesseract || window.Tesseract), { once: true });
          existing.addEventListener('error', (e) => reject(new Error('Не удалось загрузить Tesseract.js: ' + (e.message || 'ошибка сети'))), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = TESSERACT_CDN_URL;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
          const tess = globalThis.Tesseract || window.Tesseract;
          if (tess) {
            resolve(tess);
          } else {
            reject(new Error('Библиотека Tesseract.js загрузилась, но глобальный объект Tesseract отсутствует'));
          }
        };
        script.onerror = () => {
          tesseractLoadingPromise = null;
          reject(new Error('Не удалось загрузить Tesseract.js с CDN. Проверьте интернет-соединение.'));
        };
        document.head.appendChild(script);
      });

      return tesseractLoadingPromise;
    }

    return Promise.reject(new Error('Tesseract.js доступен только в среде браузера'));
  }

  /**
   * Инициализация и получение Web Worker Tesseract с поддержкой языков rus+eng
   */
  async function getOcrWorker(options = {}) {
    if (options.worker) {
      return options.worker;
    }
    if (activeWorkerInstance) {
      return activeWorkerInstance;
    }
    if (workerInitializationPromise) {
      return workerInitializationPromise;
    }

    workerInitializationPromise = (async () => {
      const Tesseract = await loadTesseract();

      if (typeof options.onProgress === 'function') {
        options.onProgress({
          current: 0,
          total: options.total || 1,
          percent: 5,
          stage: 'loading',
          details: 'Инициализация распознавания текста (Tesseract rus+eng)...',
        });
      }

      const worker = await Tesseract.createWorker(['rus', 'eng'], 1, {
        logger: (msg) => {
          if (typeof options.onWorkerProgress === 'function') {
            options.onWorkerProgress(msg);
          }
        },
        ...options.workerOptions,
      });

      activeWorkerInstance = worker;
      workerInitializationPromise = null;
      return worker;
    })();

    try {
      return await workerInitializationPromise;
    } catch (err) {
      workerInitializationPromise = null;
      throw err;
    }
  }

  /**
   * Завершение работы фонового воркера Tesseract
   */
  async function terminateWorker() {
    if (activeWorkerInstance) {
      const w = activeWorkerInstance;
      activeWorkerInstance = null;
      workerInitializationPromise = null;
      try {
        await w.terminate();
      } catch (_) {
        // игнорируем ошибки завершения воркера
      }
    }
  }

  /**
   * Проверка, является ли объект элементом изображения или холстом
   */
  function isImageOrCanvasElement(source) {
    if (!source) return false;
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) return true;
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) return true;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return true;
    if (typeof source.getContext === 'function') return true;
    if (typeof source.naturalWidth === 'number' && typeof source.naturalHeight === 'number') return true;
    return false;
  }

  /**
   * Загрузка источника изображения в HTMLImageElement / Canvas
   */
  function loadImageSource(source) {
    if (isImageOrCanvasElement(source)) {
      if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement && !source.complete) {
        return new Promise((resolve, reject) => {
          source.addEventListener('load', () => resolve(source), { once: true });
          source.addEventListener('error', (e) => reject(new Error('Не удалось загрузить изображение: ' + (e.message || 'ошибка'))), { once: true });
        });
      }
      return Promise.resolve(source);
    }

    if (typeof Image === 'undefined') {
      return Promise.reject(new Error('Image конструктор недоступен в данном окружении'));
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let blobUrl = null;

      img.onload = () => {
        if (blobUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(blobUrl);
        }
        resolve(img);
      };

      img.onerror = () => {
        if (blobUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(blobUrl);
        }
        reject(new Error('Не удалось загрузить или декодировать изображение'));
      };

      if (typeof Blob !== 'undefined' && source instanceof Blob) {
        blobUrl = URL.createObjectURL(source);
        img.src = blobUrl;
      } else if (typeof source === 'string') {
        img.src = source;
      } else {
        reject(new Error('Неподдерживаемый формат источника изображения'));
      }
    });
  }

  /**
   * Создание холста Canvas с учетом среды исполнения
   */
  function createCanvas(width, height, options = {}) {
    if (options.createCanvas && typeof options.createCanvas === 'function') {
      return options.createCanvas(width, height);
    }
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }
    return {
      width,
      height,
      getContext: () => null,
    };
  }

  /**
   * Canvas-предобработка скриншота:
   * - Нормализация масштаба (если ширина < 1200px, масштабирование 1.5–2× для повышения резкости мелкого текста)
   * - Преобразование в оттенки серого (grayscale)
   * - Адаптивное повышение контраста и бинаризация (отсечение полутонов для четких контуров цифр)
   */
  async function preprocessCanvas(imageSource, options = {}) {
    const loaded = await loadImageSource(imageSource);
    const srcWidth = loaded.naturalWidth || loaded.width || 0;
    const srcHeight = loaded.naturalHeight || loaded.height || 0;

    if (!srcWidth || !srcHeight) {
      throw new Error('Некорректные габариты изображения: ширина или высота равна 0');
    }

    // 1. Нормализация масштаба
    let scale = 1.0;
    if (typeof options.scale === 'number' && options.scale > 0) {
      scale = options.scale;
    } else if (srcWidth < 1200) {
      scale = Math.min(2.0, Math.max(1.5, 1600 / srcWidth));
    } else if (srcWidth > 3200) {
      scale = 2400 / srcWidth;
    }

    const targetWidth = Math.round(srcWidth * scale);
    const targetHeight = Math.round(srcHeight * scale);

    const canvas = createCanvas(targetWidth, targetHeight, options);
    const ctx = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;

    if (!ctx) {
      return canvas;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loaded, 0, 0, targetWidth, targetHeight);

    // 2. Grayscale & Contrast / Thresholding
    const doGrayscale = options.grayscale !== false;
    const contrastFactor = typeof options.contrast === 'number' ? options.contrast : 1.35;
    const doThreshold = Boolean(options.threshold);
    const thresholdVal = typeof options.threshold === 'number' ? options.threshold : 140;

    if (doGrayscale || contrastFactor !== 1.0 || doThreshold) {
      try {
        const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imgData.data;
        const totalPixels = data.length;

        for (let i = 0; i < totalPixels; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Grayscale по формуле ITU-R BT.601
          let gray = (r * 77 + g * 150 + b * 29) >> 8;

          // Повышение контраста
          if (contrastFactor !== 1.0) {
            gray = Math.round((gray - 128) * contrastFactor + 128);
          }

          // Пороговая бинаризация
          if (doThreshold) {
            gray = gray >= thresholdVal ? 255 : 0;
          } else {
            if (gray < 0) gray = 0;
            else if (gray > 255) gray = 255;
          }

          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(imgData, 0, 0);
      } catch (_) {
        // Игнорируем ошибки при tainted canvas в кросс-доменных тестах
      }
    }

    return canvas;
  }

  const preprocessImageForOcr = preprocessCanvas;

  /**
   * Разрезание 2-колоночного инвентаря склада на левую и правую колонки
   * с небольшим нахлестом, предотвращая перемешивание строк при горизонтальном чтении
   */
  function splitWarehouseColumns(canvas, options = {}) {
    if (!canvas || !canvas.width || !canvas.height) {
      return [canvas];
    }

    const w = canvas.width;
    const h = canvas.height;

    const forceSplit = Boolean(options.forceSplit);
    const isWideEnough = w >= 600 && (w / h) >= 0.40;

    if (!forceSplit && !isWideEnough) {
      return [canvas];
    }

    // Левая колонка (53% ширины для исключения обрезки текста по центру)
    const leftW = Math.round(w * 0.53);
    // Правая колонка (начиная с 47% ширины)
    const rightX = Math.round(w * 0.47);
    const rightW = w - rightX;

    const leftCanvas = createCanvas(leftW, h, options);
    const rightCanvas = createCanvas(rightW, h, options);

    const leftCtx = leftCanvas.getContext ? leftCanvas.getContext('2d') : null;
    const rightCtx = rightCanvas.getContext ? rightCanvas.getContext('2d') : null;

    if (!leftCtx || !rightCtx) {
      return [canvas];
    }

    leftCtx.drawImage(canvas, 0, 0, leftW, h, 0, 0, leftW, h);
    rightCtx.drawImage(canvas, rightX, 0, rightW, h, 0, 0, rightW, h);

    return [leftCanvas, rightCanvas];
  }

  /**
   * Главная функция распознавания пачки скриншотов Smart Scanner
   *
   * @param {Array<File|Blob|string|HTMLImageElement|HTMLCanvasElement>} files
   * @param {Function} [onProgress] Коллбэк прогресса ({ current, total, percent, stage, details })
   * @param {Object} [options] Дополнительные параметры обработки
   * @returns {Promise<{
   *   success: boolean,
   *   sector: Object,
   *   stock: Object,
   *   totalStarPoints: number,
   *   imagesProcessed: number,
   *   rawTexts: string[]
   * }>}
   */
  async function runSmartOcr(files, onProgress, options = {}) {
    const fileList = Array.isArray(files) ? files : (files ? [files] : []);
    const logic = resolveLogic(options.logic);

    if (!logic) {
      throw new Error('Модуль logic.js не найден для обработки результатов OCR');
    }

    const total = fileList.length;
    const rawTexts = [];
    let accumulated = { sector: {}, stock: {} };
    let processedCount = 0;

    if (total === 0) {
      return {
        success: true,
        sector: {},
        stock: {},
        totalStarPoints: 0,
        imagesProcessed: 0,
        rawTexts: [],
      };
    }

    function reportProgress(step) {
      if (typeof onProgress === 'function') {
        try {
          onProgress(step);
        } catch (_) {}
      }
    }

    reportProgress({
      current: 0,
      total,
      percent: 5,
      stage: 'loading',
      details: 'Подключение OCR-движка Tesseract (rus+eng)...',
    });

    const worker = await getOcrWorker({
      worker: options.worker,
      onProgress: reportProgress,
      onWorkerProgress: (m) => {
        if (m && m.status === 'recognizing text') {
          const subProgress = Math.min(1, Math.max(0, Number(m.progress) || 0));
          const basePercent = 10 + (processedCount / total) * 80;
          const currentPercent = Math.min(95, Math.round(basePercent + (subProgress / total) * 80));
          reportProgress({
            current: processedCount + 1,
            total,
            percent: currentPercent,
            stage: 'recognizing',
            details: `Распознавание текста (${Math.round(subProgress * 100)}%)...`,
          });
        }
      },
    });

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      const currentNumber = i + 1;
      const basePercent = Math.round(10 + (i / total) * 80);

      reportProgress({
        current: currentNumber,
        total,
        percent: basePercent,
        stage: 'preprocessing',
        details: `Предобработка изображения ${currentNumber} из ${total}...`,
      });

      const preprocessedCanvas = await preprocessCanvas(file, options);

      reportProgress({
        current: currentNumber,
        total,
        percent: Math.min(95, basePercent + Math.round(40 / total)),
        stage: 'recognizing',
        details: `Распознавание скриншота ${currentNumber} из ${total}...`,
      });

      // Первичное распознавание
      const ocrResult = await worker.recognize(preprocessedCanvas);
      let extractedText = (ocrResult && ocrResult.data && ocrResult.data.text) || '';

      // Классификация и парсинг текста
      let profileParsed = logic.parseProfileScreenshotText(extractedText);
      let warehouseParsed = logic.parseWarehouseScreenshotText(extractedText);

      // Если это складской скриншот или включена опция splitWarehouse — выполняем анализ по колонкам
      const shouldTrySplit = options.splitWarehouse || (warehouseParsed.isWarehouse && options.splitWarehouse !== false);
      if (shouldTrySplit && !profileParsed.isProfile) {
        const columns = splitWarehouseColumns(preprocessedCanvas, options);
        if (columns.length > 1) {
          const col1Res = await worker.recognize(columns[0]);
          const col2Res = await worker.recognize(columns[1]);
          const col1Text = (col1Res && col1Res.data && col1Res.data.text) || '';
          const col2Text = (col2Res && col2Res.data && col2Res.data.text) || '';
          const splitCombinedText = `${col1Text}\n${col2Text}`;

          const splitWarehouseParsed = logic.parseWarehouseScreenshotText(splitCombinedText);
          const countOriginal = Object.keys(warehouseParsed.stock || {}).length;
          const countSplit = Object.keys(splitWarehouseParsed.stock || {}).length;
          if (countSplit >= countOriginal) {
            extractedText = splitCombinedText;
            warehouseParsed = splitWarehouseParsed;
          }
        }
      }

      rawTexts.push(extractedText);

      reportProgress({
        current: currentNumber,
        total,
        percent: Math.min(98, Math.round(10 + (currentNumber / total) * 80)),
        stage: 'parsing',
        details: `Слияние данных скриншота ${currentNumber} из ${total}...`,
      });

      // Объединение результатов текущего скриншота с накопленными
      const currentScan = {
        isProfile: profileParsed.isProfile,
        isWarehouse: warehouseParsed.isWarehouse,
        sector: profileParsed.sector || {},
        stock: warehouseParsed.stock || {},
      };

      accumulated = logic.mergeScanResults(accumulated, currentScan);
      processedCount++;
    }

    if (options.terminateWorkerOnComplete) {
      await terminateWorker();
    }

    const finalSector = accumulated.sector || {};
    const finalStock = accumulated.stock || {};
    const totalStarPoints = logic.calculateTotalStarPoints(finalStock);

    reportProgress({
      current: total,
      total,
      percent: 100,
      stage: 'done',
      details: 'Распознавание успешно завершено',
    });

    return {
      success: true,
      sector: finalSector,
      stock: finalStock,
      totalStarPoints,
      imagesProcessed: processedCount,
      rawTexts,
    };
  }

  /**
   * Распознавание скриншота магазина обмена медалей («Обмен на медали офицера»)
   * @param {File|Blob|Array<File|Blob>} filesOrFile
   * @param {Object} options
   * @returns {Promise<{success: boolean, officers: Array<Object>, imagesProcessed: number, rawTexts: string[]}>}
   */
  async function runExchangeShopOcr(filesOrFile, options = {}) {
    const fileList = Array.isArray(filesOrFile)
      ? filesOrFile
      : (filesOrFile && typeof filesOrFile.length === 'number' && typeof filesOrFile !== 'string' && !(filesOrFile instanceof Blob))
        ? Array.from(filesOrFile)
        : [filesOrFile];

    const total = Math.max(1, fileList.length);
    let processedCount = 0;
    const rawTexts = [];
    const recognizedOfficers = [];

    const logic = resolveLogic(options.logic);
    if (!logic || typeof logic.parseExchangeShopScreenshotText !== 'function') {
      return {
        success: false,
        error: 'Модуль логики logic.js недоступен или не содержит parseExchangeShopScreenshotText',
        officers: [],
        imagesProcessed: 0,
        rawTexts: [],
      };
    }

    const onProgress = options.onProgress;
    function reportProgress(step) {
      if (typeof onProgress === 'function') {
        try {
          onProgress(step);
        } catch (_) {}
      }
    }

    reportProgress({
      current: 0,
      total,
      percent: 5,
      stage: 'loading',
      details: 'Подключение OCR-движка Tesseract (rus+eng)...',
    });

    const worker = await getOcrWorker({
      worker: options.worker,
      onProgress: reportProgress,
      onWorkerProgress: (m) => {
        if (m && m.status === 'recognizing text') {
          const subProgress = Math.min(1, Math.max(0, Number(m.progress) || 0));
          const basePercent = 10 + (processedCount / total) * 80;
          const currentPercent = Math.min(95, Math.round(basePercent + (subProgress / total) * 80));
          reportProgress({
            current: processedCount + 1,
            total,
            percent: currentPercent,
            stage: 'recognizing',
            details: `Распознавание текста магазина (${Math.round(subProgress * 100)}%)...`,
          });
        }
      },
    });

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      const currentNumber = i + 1;
      const basePercent = Math.round(10 + (i / total) * 80);

      reportProgress({
        current: currentNumber,
        total,
        percent: basePercent,
        stage: 'preprocessing',
        details: `Предобработка скриншота ${currentNumber} из ${total}...`,
      });

      const preprocessedCanvas = await preprocessCanvas(file, options);

      reportProgress({
        current: currentNumber,
        total,
        percent: Math.min(95, basePercent + Math.round(40 / total)),
        stage: 'recognizing',
        details: `Распознавание скриншота ${currentNumber} из ${total}...`,
      });

      const ocrResult = await worker.recognize(preprocessedCanvas);
      const extractedText = (ocrResult && ocrResult.data && ocrResult.data.text) || '';
      rawTexts.push(extractedText);

      reportProgress({
        current: currentNumber,
        total,
        percent: Math.min(98, Math.round(10 + (currentNumber / total) * 80)),
        stage: 'parsing',
        details: `Поиск командиров в тексте скриншота ${currentNumber} из ${total}...`,
      });

      const parsedItems = logic.parseExchangeShopScreenshotText(extractedText);
      if (Array.isArray(parsedItems)) {
        for (const item of parsedItems) {
          if (!recognizedOfficers.some(o => o.name.toLowerCase() === item.name.toLowerCase())) {
            recognizedOfficers.push(item);
          }
        }
      }
      processedCount++;
    }

    if (options.terminateWorkerOnComplete) {
      await terminateWorker();
    }

    reportProgress({
      current: total,
      total,
      percent: 100,
      stage: 'done',
      details: 'Распознавание магазина обмена успешно завершено',
    });

    return {
      success: true,
      officers: recognizedOfficers,
      imagesProcessed: processedCount,
      rawTexts,
    };
  }

  const smartScanner = {
    runSmartOcr,
    runExchangeShopOcr,
    preprocessCanvas,
    preprocessImageForOcr,
    splitWarehouseColumns,
    loadTesseract,
    getOcrWorker,
    terminateWorker,
  };

  return smartScanner;
});
