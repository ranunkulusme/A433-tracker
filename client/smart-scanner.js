/**
 * KoW Tracker - Smart Scanner Client Module (OCR UI & Application)
 *
 * Encapsulates the UI controllers for:
 * 1. Profile & Warehouse Smart Scanner (modal, dropzone, canvas preview, star points, profile & player application)
 * 2. Exchange Shop Catalog OCR (modal, multi-image dropzone, parsing table, batch submission)
 * Zero external dependencies.
 */

(function (root) {
  'use strict';

  // ─── 1. PROFILE & WAREHOUSE SMART SCANNER ────────────────────────
  let activeScannerContext = 'my_cabinet'; // 'my_cabinet' | 'player'
  let lastScanResults = null;
  let isScannerRunning = false;

  function openSmartScannerModal(targetContext = 'my_cabinet') {
    activeScannerContext = targetContext || 'my_cabinet';
    lastScanResults = null;
    isScannerRunning = false;

    initSmartScanner();

    const btnApply = document.getElementById('scanner-btn-apply');
    if (btnApply) btnApply.disabled = true;

    const fileInput = document.getElementById('scanner-file-input');
    if (fileInput) fileInput.value = '';

    const dropzone = document.getElementById('scanner-dropzone');
    if (dropzone) {
      dropzone.style.display = 'block';
      dropzone.classList.remove('dragover');
    }

    const progressCont = document.getElementById('scanner-progress-container');
    if (progressCont) progressCont.style.display = 'none';

    const resultsCont = document.getElementById('scanner-results-container');
    if (resultsCont) resultsCont.style.display = 'none';

    const barEl = document.getElementById('scanner-progress-bar');
    if (barEl) barEl.style.width = '0%';
    const percentEl = document.getElementById('scanner-progress-percent');
    if (percentEl) percentEl.textContent = '0%';
    const statusEl = document.getElementById('scanner-progress-status');
    if (statusEl) statusEl.textContent = 'Подготовка OCR...';
    const detailsEl = document.getElementById('scanner-progress-details');
    if (detailsEl) detailsEl.textContent = '';

    if (typeof openModal === 'function') {
      openModal('modal-smart-scanner');
    } else {
      document.getElementById('modal-smart-scanner')?.classList.add('open');
      document.getElementById('overlay')?.classList.add('open');
    }
  }

  function closeSmartScannerModal() {
    const modal = document.getElementById('modal-smart-scanner');
    if (modal) modal.classList.remove('open');

    const otherOpenModal = document.querySelector('.modal.open:not(#modal-smart-scanner)');
    if (!otherOpenModal) {
      document.getElementById('overlay')?.classList.remove('open');
    }
  }

  function updateScannerPreviewStarPoints() {
    const s1 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-1')?.value) || 0);
    const s2 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-2')?.value) || 0);
    const s3 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-3')?.value) || 0);
    const calcFn = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints : null;
    const total = calcFn ? calcFn({ legendaryStars1: s1, legendaryStars2: s2, legendaryStars3: s3 }) : ((s1 * 110) + (s2 * 420) + (s3 * 960));
    const badge = document.getElementById('scanner-preview-star-points-badge');
    if (badge) {
      const formatFn = typeof fmtNum === 'function' ? fmtNum : (n => Number(n).toLocaleString('ru-RU'));
      badge.textContent = `✨ Итого очков звезд: ${formatFn(total)}`;
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      if (typeof file === 'string') return resolve(file);
      if (!file) return resolve('');

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения'));

      // If outside a DOM browser or Image/canvas unsupported, read file directly
      if (typeof Image === 'undefined' || typeof document === 'undefined' || !document.createElement) {
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
        return;
      }

      reader.onload = () => {
        const dataUrl = reader.result;
        if (!dataUrl || typeof dataUrl !== 'string') return resolve(dataUrl);

        try {
          const img = new Image();
          img.onload = () => {
            const maxDim = 2200;
            let w = img.width;
            let h = img.height;
            // If already within reasonable dimensions and size, keep original bytes
            if (w <= maxDim && h <= maxDim && (!file.size || file.size < 3 * 1024 * 1024)) {
              return resolve(dataUrl);
            }
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(dataUrl);
            ctx.drawImage(img, 0, 0, w, h);
            const optimizedUrl = canvas.toDataURL('image/jpeg', 0.90);
            resolve(optimizedUrl || dataUrl);
          };
          img.onerror = () => resolve(dataUrl);
          img.src = dataUrl;
        } catch (_) {
          resolve(dataUrl);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function handleScannerFileInput(event) {
    const files = Array.from(event?.target?.files || []);
    if (event?.target) event.target.value = '';
    if (files.length > 0) {
      const runner = (typeof smartScannerUI !== 'undefined' && smartScannerUI.handleScannerFiles) || handleScannerFiles;
      runner(files);
    }
  }

  function handleExchangeFileInput(event) {
    const files = Array.from(event?.target?.files || []);
    if (event?.target) event.target.value = '';
    if (files.length > 0) {
      const runner = (typeof smartScannerUI !== 'undefined' && smartScannerUI.handleExchangeFiles) || handleExchangeFiles;
      runner(files);
    }
  }

  async function handleScannerFiles(fileList) {
    if (isScannerRunning) return;
    const files = Array.from(fileList || []).filter(f => {
      return f && (typeof f === 'string' || f.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name || ''));
    });

    if (!files.length) {
      if (typeof toast === 'function') toast('Пожалуйста, выберите файлы изображений (PNG, JPG, WebP)', 'error');
      return;
    }

    const progressCont = document.getElementById('scanner-progress-container');
    const resultsCont = document.getElementById('scanner-results-container');
    const statusEl = document.getElementById('scanner-progress-status');
    const percentEl = document.getElementById('scanner-progress-percent');
    const barEl = document.getElementById('scanner-progress-bar');
    const detailsEl = document.getElementById('scanner-progress-details');
    const btnApply = document.getElementById('scanner-btn-apply');

    if (progressCont) progressCont.style.display = 'flex';
    if (resultsCont) resultsCont.style.display = 'none';
    if (btnApply) btnApply.disabled = true;

    isScannerRunning = true;

    try {
      if (statusEl) statusEl.textContent = 'Подготовка скриншотов...';
      if (percentEl) percentEl.textContent = '20%';
      if (barEl) barEl.style.width = '20%';
      if (detailsEl) detailsEl.textContent = `Загрузка ${files.length} скриншот(ов)...`;

      const base64Images = [];
      for (const file of files) {
        const b64 = await readFileAsBase64(file);
        base64Images.push(b64);
      }

      if (statusEl) statusEl.textContent = 'Распознавание на сервере (OCR rus+eng+deu)...';
      if (percentEl) percentEl.textContent = '60%';
      if (barEl) barEl.style.width = '60%';
      if (detailsEl) detailsEl.textContent = 'Обработка скриншотов нативным Tesseract...';

      let result = null;
      const fetchFn = (typeof apiFetch === 'function' ? apiFetch : null) ||
        (typeof window !== 'undefined' ? window.apiFetch : null) ||
        (typeof globalThis !== 'undefined' ? globalThis.apiFetch : null);

      if (fetchFn) {
        const scanRes = await fetchFn('/api/ocr/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: base64Images })
        });

        // apiFetch in app.js returns parsed JSON directly; standard fetch returns a Response
        if (scanRes && typeof scanRes.json === 'function') {
          if (!scanRes.ok) {
            const errJson = await scanRes.json().catch(() => ({}));
            throw new Error(errJson.message || 'Ошибка распознавания на сервере');
          }
          result = await scanRes.json();
        } else if (typeof scanRes === 'string') {
          try {
            result = JSON.parse(scanRes);
          } catch (_) {
            result = { success: false, message: scanRes };
          }
        } else {
          result = scanRes;
        }

        if (!result || result.success === false) {
          throw new Error(result?.message || 'Ошибка распознавания на сервере');
        }
      } else {
        const scanner = (typeof window !== 'undefined' && window.smartScanner) || (typeof smartScanner !== 'undefined' ? smartScanner : null);
        if (scanner && typeof scanner.runSmartOcr === 'function') {
          result = await scanner.runSmartOcr(files);
        } else {
          throw new Error('Модуль распознавания недоступен');
        }
      }

      if (percentEl) percentEl.textContent = '100%';
      if (barEl) barEl.style.width = '100%';
      if (statusEl) statusEl.textContent = result.hasRecognizedData ? '✓ Готово!' : '⚠️ Данные не найдены';
      if (detailsEl) {
        detailsEl.textContent = result.hasRecognizedData
          ? `Распознано параметров: ${result.recognizedFields?.length || 0}`
          : 'На скриншотах не обнаружены параметры склада или профиля';
      }

      lastScanResults = result;
      ((typeof smartScannerUI !== 'undefined' && smartScannerUI.displayScannerResults) || displayScannerResults)(result);
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Ошибка распознавания';
      if (detailsEl) detailsEl.textContent = err.message || '';
      if (typeof toast === 'function') toast('Ошибка сканера: ' + (err.message || 'не удалось распознать скриншоты'), 'error');
    } finally {
      isScannerRunning = false;
    }
  }

  function displayScannerResults(result) {
    const resultsCont = document.getElementById('scanner-results-container');
    if (!resultsCont) return;

    resultsCont.style.display = 'flex';

    const recognizedFields = Array.isArray(result?.recognizedFields) ? result.recognizedFields : [];
    const hasRecognizedData = Boolean(result?.hasRecognizedData && recognizedFields.length > 0);

    const summaryEl = document.getElementById('scanner-results-summary');
    if (summaryEl) {
      const count = result?.imagesProcessed || 1;
      if (hasRecognizedData) {
        summaryEl.className = 'scanner-results-summary';
        summaryEl.textContent = `✓ Успешно обработано скриншотов: ${count}. Распознано параметров: ${recognizedFields.length}. Проверьте подсвеченные поля перед применением:`;
      } else {
        summaryEl.className = 'scanner-results-summary error';
        summaryEl.textContent = `⚠️ На скриншотах не удалось обнаружить данные склада или профиля. Поля остались со старыми значениями. Проверьте скриншоты или введите значения вручную.`;
      }
    }

    function markField(inputEl, fieldKey) {
      if (!inputEl) return;
      const isRecognized = recognizedFields.includes(fieldKey);
      const parent = inputEl.closest ? (inputEl.closest('.form-group') || inputEl.parentElement) : inputEl.parentElement;
      const existingBadge = parent?.querySelector ? parent.querySelector('.ocr-detected-badge') : null;

      if (isRecognized) {
        inputEl.classList?.add('ocr-detected-input');
        if (!existingBadge && parent && typeof document !== 'undefined') {
          const label = parent.querySelector ? parent.querySelector('label') : null;
          if (label && typeof document.createElement === 'function') {
            const badge = document.createElement('span');
            badge.className = 'ocr-detected-badge';
            badge.textContent = '✓ Со скриншота';
            label.appendChild(badge);
          }
        }
      } else {
        inputEl.classList?.remove('ocr-detected-input');
        if (existingBadge && typeof existingBadge.remove === 'function') {
          existingBadge.remove();
        }
      }
    }

    let currentSector = {};
    let currentStock = {};
    let currentName = '';

    const myCabinet = typeof myCabinetProfile !== 'undefined' ? myCabinetProfile : null;

    if (activeScannerContext === 'my_cabinet') {
      currentSector = myCabinet?.sector || {};
      currentStock = myCabinet?.stock || {};
      currentName = myCabinet?.name || '';
    } else if (activeScannerContext === 'player') {
      currentSector = {
        power: parseInt(document.getElementById('fp-power')?.value) || 0,
        kills: parseInt(document.getElementById('fp-kills')?.value) || 0,
        killPoints: parseFloat(document.getElementById('fp-kill-points')?.value) || 0,
      };
      currentStock = {
        coupons: parseInt(document.getElementById('fp-stock-coupons')?.value) || 0,
        puzzles: parseInt(document.getElementById('fp-stock-puzzles')?.value) || 0,
        starCoupons: parseInt(document.getElementById('fp-stock-star-coupons')?.value) || 0,
        legendaryStars1: parseInt(document.getElementById('fp-stock-legendary-stars-1')?.value) || 0,
        legendaryStars2: parseInt(document.getElementById('fp-stock-legendary-stars-2')?.value) || 0,
        legendaryStars3: parseInt(document.getElementById('fp-stock-legendary-stars-3')?.value) || 0,
        chests: parseInt(document.getElementById('fp-stock-chests')?.value) || 0,
      };
      currentName = document.getElementById('fp-name')?.value || '';
    }

    const s = result?.sector || {};
    const st = result?.stock || {};

    const nickInput = document.getElementById('scanner-preview-nickname');
    const updateNickCheck = document.getElementById('scanner-preview-update-nickname');
    const detectedName = s.name || s.nickname || '';
    if (nickInput) {
      nickInput.value = detectedName || currentName || '';
    }
    if (updateNickCheck) {
      updateNickCheck.checked = Boolean(detectedName);
    }
    markField(nickInput, 'name');

    const fmt = typeof formatInputNumber === 'function' ? formatInputNumber : (n => String(n));

    const powerInput = document.getElementById('scanner-preview-power');
    if (powerInput) {
      const val = s.power !== undefined ? s.power : (currentSector.power || 0);
      powerInput.value = fmt(val);
    }
    markField(powerInput, 'power');

    const killsInput = document.getElementById('scanner-preview-kills');
    if (killsInput) {
      const val = s.kills !== undefined ? s.kills : (currentSector.kills || 0);
      killsInput.value = fmt(val);
    }
    markField(killsInput, 'kills');

    const kpInput = document.getElementById('scanner-preview-kill-points');
    if (kpInput) {
      const val = s.killPoints !== undefined ? s.killPoints : (currentSector.killPoints || 0);
      kpInput.value = fmt(val, true);
    }
    markField(kpInput, 'killPoints');

    const couponsInput = document.getElementById('scanner-preview-coupons');
    if (couponsInput) {
      const val = st.coupons !== undefined ? st.coupons : (currentStock.coupons || 0);
      couponsInput.value = fmt(val);
    }
    markField(couponsInput, 'coupons');

    const puzzlesInput = document.getElementById('scanner-preview-puzzles');
    if (puzzlesInput) {
      const val = st.puzzles !== undefined ? st.puzzles : (currentStock.puzzles || 0);
      puzzlesInput.value = fmt(val);
    }
    markField(puzzlesInput, 'puzzles');

    const chestsInput = document.getElementById('scanner-preview-chests');
    if (chestsInput) {
      const val = st.chests !== undefined ? st.chests : (currentStock.chests || 0);
      chestsInput.value = fmt(val);
    }
    markField(chestsInput, 'chests');

    const starCouponsInput = document.getElementById('scanner-preview-star-coupons');
    if (starCouponsInput) {
      const val = st.starCoupons !== undefined ? st.starCoupons : (currentStock.starCoupons || 0);
      starCouponsInput.value = fmt(val);
    }
    markField(starCouponsInput, 'starCoupons');

    const stars1Input = document.getElementById('scanner-preview-stars-1');
    if (stars1Input) {
      const val = st.legendaryStars1 !== undefined ? st.legendaryStars1 : (currentStock.legendaryStars1 || 0);
      stars1Input.value = fmt(val);
    }
    markField(stars1Input, 'legendaryStars1');

    const stars2Input = document.getElementById('scanner-preview-stars-2');
    if (stars2Input) {
      const val = st.legendaryStars2 !== undefined ? st.legendaryStars2 : (currentStock.legendaryStars2 || 0);
      stars2Input.value = fmt(val);
    }
    markField(stars2Input, 'legendaryStars2');

    const stars3Input = document.getElementById('scanner-preview-stars-3');
    if (stars3Input) {
      const val = st.legendaryStars3 !== undefined ? st.legendaryStars3 : (currentStock.legendaryStars3 || 0);
      stars3Input.value = fmt(val);
    }
    markField(stars3Input, 'legendaryStars3');

    // Injected OCR raw text display
    const rawDetailsEl = document.getElementById('scanner-raw-details');
    const rawPreEl = document.getElementById('scanner-raw-text-pre');
    if (rawDetailsEl && rawPreEl) {
      if (result?.rawText && String(result.rawText).trim()) {
        rawPreEl.textContent = String(result.rawText).trim();
        rawDetailsEl.style.display = 'block';
      } else {
        rawDetailsEl.style.display = 'none';
      }
    }

    if (typeof bindAllNumericInputs === 'function') {
      bindAllNumericInputs(resultsCont);
    }

    updateScannerPreviewStarPoints();

    const btnApply = document.getElementById('scanner-btn-apply');
    if (btnApply) {
      btnApply.disabled = false;
      if (!hasRecognizedData) {
        btnApply.textContent = '✓ Сохранить текущие значения';
      } else {
        btnApply.textContent = '✓ Применить в профиль';
      }
    }
  }

  async function applyScanResultsToProfile() {
    const btnApply = document.getElementById('scanner-btn-apply');
    const updateNick = document.getElementById('scanner-preview-update-nickname')?.checked;
    const nick = document.getElementById('scanner-preview-nickname')?.value?.trim();

    const parseNum = typeof parseInputNumber === 'function' ? parseInputNumber : (v => Number(String(v).replace(/\s/g, '')) || 0);
    const fmt = typeof formatInputNumber === 'function' ? formatInputNumber : (n => String(n));

    const power = Math.max(0, parseNum(document.getElementById('scanner-preview-power')?.value || 0));
    const kills = Math.max(0, parseNum(document.getElementById('scanner-preview-kills')?.value || 0));
    const killPoints = Math.max(0, parseNum(document.getElementById('scanner-preview-kill-points')?.value || 0, true));

    const coupons = Math.max(0, parseNum(document.getElementById('scanner-preview-coupons')?.value || 0));
    const puzzles = Math.max(0, parseNum(document.getElementById('scanner-preview-puzzles')?.value || 0));
    const chests = Math.max(0, parseNum(document.getElementById('scanner-preview-chests')?.value || 0));
    const starCoupons = Math.max(0, parseNum(document.getElementById('scanner-preview-star-coupons')?.value || 0));
    const legendaryStars1 = Math.max(0, parseNum(document.getElementById('scanner-preview-stars-1')?.value || 0));
    const legendaryStars2 = Math.max(0, parseNum(document.getElementById('scanner-preview-stars-2')?.value || 0));
    const legendaryStars3 = Math.max(0, parseNum(document.getElementById('scanner-preview-stars-3')?.value || 0));

    const myCabinet = typeof myCabinetProfile !== 'undefined' ? myCabinetProfile : null;

    if (activeScannerContext === 'my_cabinet') {
      if (document.getElementById('my-sector-power')) document.getElementById('my-sector-power').value = fmt(power);
      if (document.getElementById('my-sector-kills')) document.getElementById('my-sector-kills').value = fmt(kills);
      if (document.getElementById('my-sector-kill-points')) document.getElementById('my-sector-kill-points').value = fmt(killPoints, true);

      if (document.getElementById('my-stock-coupons')) document.getElementById('my-stock-coupons').value = fmt(coupons);
      if (document.getElementById('my-stock-puzzles')) document.getElementById('my-stock-puzzles').value = fmt(puzzles);
      if (document.getElementById('my-stock-chests')) document.getElementById('my-stock-chests').value = fmt(chests);
      if (document.getElementById('my-stock-star-coupons')) document.getElementById('my-stock-star-coupons').value = fmt(starCoupons);
      if (document.getElementById('my-stock-legendary-stars-1')) document.getElementById('my-stock-legendary-stars-1').value = fmt(legendaryStars1);
      if (document.getElementById('my-stock-legendary-stars-2')) document.getElementById('my-stock-legendary-stars-2').value = fmt(legendaryStars2);
      if (document.getElementById('my-stock-legendary-stars-3')) document.getElementById('my-stock-legendary-stars-3').value = fmt(legendaryStars3);
      if (typeof updateCabinetTotalStarPoints === 'function') {
        updateCabinetTotalStarPoints();
      }

      const vipLevel = myCabinet?.sector?.vipLevel || 0;
      const vipPoints = myCabinet?.sector?.vipPoints || 0;
      const confidentialityLevel = myCabinet?.sector?.confidentialityLevel || 0;

      const activeSectorId = myCabinet?.id || myCabinet?.activeSectorId;
      const currentStock = myCabinet?.stock ? { ...myCabinet.stock } : {};

      const payload = {
        sector: { vipLevel, vipPoints, confidentialityLevel, power, kills, killPoints },
        stock: { coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests },
        stockUpdateSource: 'ocr_scan'
      };
      if (updateNick && nick) {
        payload.name = nick;
      }

      try {
        if (btnApply) {
          btnApply.disabled = true;
          btnApply.textContent = 'Применение...';
        }
        if (typeof apiFetch === 'function') {
          await apiFetch('/api/my-profile', {
            method: 'PUT',
            body: payload
          });
        }

        const scanner = (typeof window !== 'undefined' && window.smartScanner) || (typeof smartScanner !== 'undefined' ? smartScanner : null);
        const screenshotBase64 = lastScanResults?.screenshotBase64 ||
          (scanner && typeof scanner.getLastScreenshotBase64 === 'function' ? scanner.getLastScreenshotBase64() : null);

        if (screenshotBase64 && activeSectorId && typeof apiFetch === 'function') {
          try {
            await apiFetch(`/api/players/${activeSectorId}/stock-history`, {
              method: 'POST',
              body: {
                source: 'ocr_scan',
                snapshotBefore: currentStock,
                snapshotAfter: payload.stock,
                screenshotBase64
              }
            });
          } catch (histErr) {
            console.warn('Failed to upload screenshot audit history:', histErr);
          }
        }

        if (typeof toast === 'function') toast('Данные Smart Scanner успешно применены в профиль!');
        closeSmartScannerModal();
        if (typeof renderMyCabinet === 'function') {
          await renderMyCabinet();
        }
      } catch (err) {
        if (typeof toast === 'function') toast('Ошибка сохранения профиля: ' + err.message, 'error');
      } finally {
        if (btnApply) {
          btnApply.disabled = false;
          btnApply.textContent = '✓ Применить в профиль';
        }
      }
    } else if (activeScannerContext === 'player') {
      if (updateNick && nick && document.getElementById('fp-name')) {
        document.getElementById('fp-name').value = nick;
      }
      if (document.getElementById('fp-power')) document.getElementById('fp-power').value = fmt(power);
      if (document.getElementById('fp-kills')) document.getElementById('fp-kills').value = fmt(kills);
      if (document.getElementById('fp-kill-points')) document.getElementById('fp-kill-points').value = fmt(killPoints, true);

      if (document.getElementById('fp-stock-coupons')) document.getElementById('fp-stock-coupons').value = fmt(coupons);
      if (document.getElementById('fp-stock-puzzles')) document.getElementById('fp-stock-puzzles').value = fmt(puzzles);
      if (document.getElementById('fp-stock-chests')) document.getElementById('fp-stock-chests').value = fmt(chests);
      if (document.getElementById('fp-stock-star-coupons')) document.getElementById('fp-stock-star-coupons').value = fmt(starCoupons);
      if (document.getElementById('fp-stock-legendary-stars-1')) document.getElementById('fp-stock-legendary-stars-1').value = fmt(legendaryStars1);
      if (document.getElementById('fp-stock-legendary-stars-2')) document.getElementById('fp-stock-legendary-stars-2').value = fmt(legendaryStars2);
      if (document.getElementById('fp-stock-legendary-stars-3')) document.getElementById('fp-stock-legendary-stars-3').value = fmt(legendaryStars3);
      if (typeof updatePlayerModalStarPoints === 'function') {
        updatePlayerModalStarPoints();
      }

      const activeEditId = typeof editPlayerId !== 'undefined' ? editPlayerId : null;
      const scanner = (typeof window !== 'undefined' && window.smartScanner) || (typeof smartScanner !== 'undefined' ? smartScanner : null);
      const screenshotBase64 = lastScanResults?.screenshotBase64 ||
        (scanner && typeof scanner.getLastScreenshotBase64 === 'function' ? scanner.getLastScreenshotBase64() : null);

      if (screenshotBase64 && activeEditId && typeof apiFetch === 'function') {
        const p = typeof getPlayer === 'function' ? getPlayer(activeEditId) : null;
        const oldStock = p ? { ...p.stock } : {};
        const newStock = {
          coupons,
          puzzles,
          starCoupons,
          legendaryStars1,
          legendaryStars2,
          legendaryStars3,
          chests: chests !== undefined ? chests : (p?.stock?.chests || 0)
        };
        try {
          await apiFetch(`/api/players/${activeEditId}/stock-history`, {
            method: 'POST',
            body: {
              source: 'ocr_scan',
              snapshotBefore: oldStock,
              snapshotAfter: newStock,
              screenshotBase64
            }
          });
          if (p) {
            p.stock = newStock;
            p.stockUpdatedAt = new Date().toISOString();
            p.stockUpdateSource = 'ocr_scan';
          }
        } catch (histErr) {
          console.warn('Failed to record stock history:', histErr);
        }
      }

      if (typeof toast === 'function') toast('Данные Smart Scanner перенесены в карточку игрока!');
      closeSmartScannerModal();
    }
  }

  function handleScannerGlobalPaste(e) {
    const smartModal = document.getElementById('modal-smart-scanner');
    const exchangeModal = document.getElementById('modal-exchange-ocr');

    const isSmartOpen = smartModal && smartModal.classList.contains('open');
    const isExchangeOpen = exchangeModal && exchangeModal.classList.contains('open');

    if (!isSmartOpen && !isExchangeOpen) return;
    if (isSmartOpen && isScannerRunning) return;
    if (isExchangeOpen && isExchangeOcrRunning) return;

    const clipboardData = e.clipboardData || (typeof window !== 'undefined' ? window.clipboardData : null);
    if (!clipboardData || !clipboardData.items) return;

    const imageFiles = [];
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          imageFiles.push(blob);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      if (isSmartOpen) {
        handleScannerFiles(imageFiles);
      } else if (isExchangeOpen) {
        handleExchangeFiles(imageFiles);
      }
    }
  }

  function initSmartScanner() {
    const dropzone = document.getElementById('scanner-dropzone');
    const fileInput = document.getElementById('scanner-file-input');
    const modal = document.getElementById('modal-smart-scanner');

    if (dropzone && !dropzone.dataset.initialized) {
      dropzone.dataset.initialized = 'true';

      dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
          handleScannerFiles(files);
        }
      });
    }

    if (modal && !modal.dataset.dropInitialized) {
      modal.dataset.dropInitialized = 'true';
      modal.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      modal.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
          handleScannerFiles(files);
        }
      });
    }

    if (fileInput && !fileInput.dataset.initialized) {
      fileInput.dataset.initialized = 'true';
      fileInput.addEventListener('change', handleScannerFileInput);
    }

    if (typeof window !== 'undefined' && !window.__scannerPasteInitialized) {
      window.__scannerPasteInitialized = true;
      window.addEventListener('paste', handleScannerGlobalPaste);
    }
  }


  // ─── 2. EXCHANGE SHOP OCR CONTROLLER ─────────────────────────────
  let isExchangeOcrRunning = false;

  function openExchangeOcrModal() {
    isExchangeOcrRunning = false;

    const fileInput = document.getElementById('exchange-file-input');
    if (fileInput) fileInput.value = '';

    const dropzone = document.getElementById('exchange-dropzone');
    if (dropzone) {
      dropzone.style.display = 'block';
      dropzone.classList.remove('dragover');
    }

    const progressCont = document.getElementById('exchange-progress-container');
    if (progressCont) progressCont.style.display = 'none';

    const resultsCont = document.getElementById('exchange-results-container');
    if (resultsCont) resultsCont.style.display = 'none';

    const tbody = document.getElementById('exchange-ocr-table-body');
    if (tbody) tbody.innerHTML = '';

    const submitBtn = document.getElementById('exchange-btn-submit');
    if (submitBtn) submitBtn.disabled = true;

    initExchangeOcr();
    if (typeof openModal === 'function') {
      openModal('modal-exchange-ocr');
    } else {
      document.getElementById('modal-exchange-ocr')?.classList.add('open');
      document.getElementById('overlay')?.classList.add('open');
    }
  }

  function closeExchangeOcrModal() {
    isExchangeOcrRunning = false;
    if (typeof closeModal === 'function') {
      closeModal('modal-exchange-ocr');
    } else {
      document.getElementById('modal-exchange-ocr')?.classList.remove('open');
      document.getElementById('overlay')?.classList.remove('open');
    }
  }

  function initExchangeOcr() {
    const dropzone = document.getElementById('exchange-dropzone');
    const fileInput = document.getElementById('exchange-file-input');

    if (dropzone && !dropzone.dataset.initialized) {
      dropzone.dataset.initialized = 'true';

      dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
          handleExchangeFiles(files);
        }
      });
    }

    const modal = document.getElementById('modal-exchange-ocr');
    if (modal && !modal.dataset.dropInitialized) {
      modal.dataset.dropInitialized = 'true';
      modal.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      modal.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
          handleExchangeFiles(files);
        }
      });
    }

    if (fileInput && !fileInput.dataset.initialized) {
      fileInput.dataset.initialized = 'true';
      fileInput.addEventListener('change', handleExchangeFileInput);
    }
  }

  async function handleExchangeFiles(filesList) {
    if (isExchangeOcrRunning) return;
    const files = Array.from(filesList || []).filter(f => f && (f.type ? f.type.startsWith('image/') : true));
    if (files.length === 0) {
      if (typeof toast === 'function') toast('Выберите файлы изображений для сканирования', 'warning');
      return;
    }

    const ocrEngine = (typeof smartScanner !== 'undefined' && smartScanner) || (typeof window !== 'undefined' && window.smartScanner);
    if (!ocrEngine || typeof ocrEngine.runExchangeShopOcr !== 'function') {
      if (typeof toast === 'function') toast('OCR-модуль не загружен', 'error');
      return;
    }

    isExchangeOcrRunning = true;

    const progressCont = document.getElementById('exchange-progress-container');
    const progressBar = document.getElementById('exchange-progress-bar');
    const progressPercent = document.getElementById('exchange-progress-percent');
    const progressStatus = document.getElementById('exchange-progress-status');
    const progressDetails = document.getElementById('exchange-progress-details');

    if (progressCont) progressCont.style.display = 'block';
    if (progressBar) progressBar.style.width = '5%';
    if (progressPercent) progressPercent.textContent = '5%';
    if (progressStatus) progressStatus.textContent = 'Подключение Tesseract OCR...';
    if (progressDetails) progressDetails.textContent = 'Загрузка словарей rus + eng';

    try {
      const activeLogic = (typeof logic !== 'undefined' ? logic : null) ||
        (typeof window !== 'undefined' && (window.logic || (typeof window.parseProfileScreenshotText === 'function' ? window : null))) ||
        (typeof globalThis !== 'undefined' && (globalThis.logic || (typeof globalThis.parseProfileScreenshotText === 'function' ? globalThis : null)));

      const result = await ocrEngine.runExchangeShopOcr(files, {
        logic: activeLogic,
        onProgress: (p) => {
          const pct = Math.min(100, Math.max(0, p.percent || 0));
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressPercent) progressPercent.textContent = `${pct}%`;
          if (progressStatus && p.details) progressStatus.textContent = p.details;
          if (progressDetails) progressDetails.textContent = `Изображение ${p.current || 1} из ${p.total || 1}`;
        }
      });

      isExchangeOcrRunning = false;

      if (result && result.success && Array.isArray(result.officers) && result.officers.length > 0) {
        renderExchangeOcrTable(result.officers);
        if (typeof toast === 'function') toast(`Распознано командиров: ${result.officers.length}`);
      } else {
        if (typeof toast === 'function') toast('Командиры не найдены на скриншоте. Вы можете добавить строку вручную.', 'warning');
        renderExchangeOcrTable([{
          name: '',
          type: 'Пехота',
          generation: 8,
          couponPerPuzzle: 720,
          starCouponCost: 360,
          medalsBeforeTraining: 690,
          medalsTraining: 900,
          medalsTotal: 1590
        }]);
      }
    } catch (err) {
      isExchangeOcrRunning = false;
      if (typeof toast === 'function') toast('Ошибка распознавания: ' + (err.message || err), 'error');
      if (progressStatus) progressStatus.textContent = 'Сбой распознавания';
    }
  }

  function renderExchangeOcrTable(officersList) {
    const tbody = document.getElementById('exchange-ocr-table-body');
    const resultsCont = document.getElementById('exchange-results-container');
    const submitBtn = document.getElementById('exchange-btn-submit');
    if (!tbody) return;

    const types = (typeof logic !== 'undefined' && logic.OFFICER_TYPES)
      ? logic.OFFICER_TYPES
      : ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

    const esc = typeof escapeHtml === 'function' ? escapeHtml : (s => String(s));

    tbody.innerHTML = (officersList || []).map((off, idx) => {
      const before = Math.max(0, parseInt(off.medalsBeforeTraining, 10) || 690);
      const training = Math.max(0, parseInt(off.medalsTraining, 10) || 900);
      const total = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
        ? logic.calculateTotalMedals(before, training)
        : (before + training);
      const offType = types.includes(off.type) ? off.type : 'Пехота';

      return `
        <tr class="exchange-ocr-row" data-idx="${idx}">
          <td>
            <input type="text" class="input-sm exchange-row-name" value="${esc(off.name || '')}" placeholder="Имя командира" style="width:100%" required>
          </td>
          <td>
            <select class="input-sm exchange-row-type" style="width:100%">
              ${types.map(t => `<option value="${t}" ${t === offType ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </td>
          <td>
            <input type="number" class="input-sm exchange-row-gen" value="${off.generation || 8}" min="1" max="25" style="width:60px">
          </td>
          <td>
            <input type="number" class="input-sm exchange-row-coupon" value="${off.couponPerPuzzle ?? 720}" min="0" step="10" style="width:75px">
          </td>
          <td>
            <input type="number" class="input-sm exchange-row-star-coupon" value="${off.starCouponCost ?? 360}" min="0" step="10" style="width:75px">
          </td>
          <td>
            <input type="number" class="input-sm exchange-row-medals-before" value="${before}" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
          </td>
          <td>
            <input type="number" class="input-sm exchange-row-medals-training" value="${training}" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
          </td>
          <td>
            <strong class="exchange-row-medals-total" style="color:var(--text1)">${total}</strong>
          </td>
          <td style="text-align:center">
            <button type="button" class="btn-sm btn-ghost" onclick="removeExchangeRow(this)" title="Удалить строку" style="color:var(--red);padding:2px 6px">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    if (resultsCont) resultsCont.style.display = 'block';
    if (submitBtn) submitBtn.disabled = tbody.children.length === 0;
  }

  function recalcExchangeRowTotal(input) {
    const row = input.closest('tr');
    if (!row) return;
    const beforeInput = row.querySelector('.exchange-row-medals-before');
    const trainingInput = row.querySelector('.exchange-row-medals-training');
    const totalElem = row.querySelector('.exchange-row-medals-total');
    const before = Math.max(0, parseInt(beforeInput?.value, 10) || 0);
    const training = Math.max(0, parseInt(trainingInput?.value, 10) || 0);
    const total = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
      ? logic.calculateTotalMedals(before, training)
      : (before + training);
    if (totalElem) totalElem.textContent = String(total);
  }

  function removeExchangeRow(btn) {
    const row = btn.closest('tr');
    if (row) row.remove();
    const tbody = document.getElementById('exchange-ocr-table-body');
    const submitBtn = document.getElementById('exchange-btn-submit');
    if (submitBtn) {
      submitBtn.disabled = !tbody || tbody.children.length === 0;
    }
  }

  function addManualExchangeRow() {
    const tbody = document.getElementById('exchange-ocr-table-body');
    const resultsCont = document.getElementById('exchange-results-container');
    const submitBtn = document.getElementById('exchange-btn-submit');
    if (!tbody) return;

    const types = (typeof logic !== 'undefined' && logic.OFFICER_TYPES)
      ? logic.OFFICER_TYPES
      : ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

    const tr = document.createElement('tr');
    tr.className = 'exchange-ocr-row';
    tr.innerHTML = `
      <td>
        <input type="text" class="input-sm exchange-row-name" value="" placeholder="Имя командира" style="width:100%" required>
      </td>
      <td>
        <select class="input-sm exchange-row-type" style="width:100%">
          ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </td>
      <td>
        <input type="number" class="input-sm exchange-row-gen" value="8" min="1" max="25" style="width:60px">
      </td>
      <td>
        <input type="number" class="input-sm exchange-row-coupon" value="720" min="0" step="10" style="width:75px">
      </td>
      <td>
        <input type="number" class="input-sm exchange-row-star-coupon" value="360" min="0" step="10" style="width:75px">
      </td>
      <td>
        <input type="number" class="input-sm exchange-row-medals-before" value="690" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
      </td>
      <td>
        <input type="number" class="input-sm exchange-row-medals-training" value="900" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
      </td>
      <td>
        <strong class="exchange-row-medals-total" style="color:var(--text1)">1590</strong>
      </td>
      <td style="text-align:center">
        <button type="button" class="btn-sm btn-ghost" onclick="removeExchangeRow(this)" title="Удалить строку" style="color:var(--red);padding:2px 6px">✕</button>
      </td>
    `;
    tbody.appendChild(tr);

    if (resultsCont) resultsCont.style.display = 'block';
    if (submitBtn) submitBtn.disabled = false;
    tr.querySelector('.exchange-row-name')?.focus();
  }

  async function submitBatchExchangeOfficers() {
    const rows = document.querySelectorAll('#exchange-ocr-table-body tr');
    if (!rows || rows.length === 0) {
      if (typeof toast === 'function') toast('Нет офицеров для добавления', 'warning');
      return;
    }

    const officers = [];
    for (const row of rows) {
      const nameInput = row.querySelector('.exchange-row-name');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        if (typeof toast === 'function') toast('Заполните имена всех офицеров в таблице', 'warning');
        if (nameInput) nameInput.focus();
        return;
      }

      const type = row.querySelector('.exchange-row-type')?.value || 'Пехота';
      const generation = Math.max(1, parseInt(row.querySelector('.exchange-row-gen')?.value, 10) || 8);
      const couponPerPuzzle = Math.max(0, parseInt(row.querySelector('.exchange-row-coupon')?.value, 10) || 720);
      const starCouponCost = Math.max(0, parseInt(row.querySelector('.exchange-row-star-coupon')?.value, 10) || 360);
      const medalsBeforeTraining = Math.max(0, parseInt(row.querySelector('.exchange-row-medals-before')?.value, 10) || 690);
      const medalsTraining = Math.max(0, parseInt(row.querySelector('.exchange-row-medals-training')?.value, 10) || 900);
      const medalsTotal = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
        ? logic.calculateTotalMedals(medalsBeforeTraining, medalsTraining)
        : (medalsBeforeTraining + medalsTraining);

      officers.push({
        name,
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType: 'standard'
      });
    }

    try {
      if (typeof apiFetch === 'function') {
        const res = await apiFetch('/api/catalog/batch', {
          method: 'POST',
          body: { officers }
        });
        closeExchangeOcrModal();
        if (typeof toast === 'function') toast(`Добавлено/обновлено офицеров: ${res?.count || officers.length}`);
        if (typeof loadDataFromServer === 'function') await loadDataFromServer();
        if (typeof renderOfficers === 'function') renderOfficers();
      }
    } catch (err) {
      if (typeof toast === 'function') toast('Ошибка сохранения офицеров: ' + (err.message || err), 'error');
    }
  }

  // ─── EXPORTS ─────────────────────────────────────────────────────
  const smartScannerUI = {
    openSmartScannerModal,
    closeSmartScannerModal,
    updateScannerPreviewStarPoints,
    handleScannerFiles,
    handleScannerFileInput,
    displayScannerResults,
    applyScanResultsToProfile,
    handleScannerGlobalPaste,
    initSmartScanner,
    openExchangeOcrModal,
    closeExchangeOcrModal,
    initExchangeOcr,
    handleExchangeFiles,
    handleExchangeFileInput,
    renderExchangeOcrTable,
    recalcExchangeRowTotal,
    removeExchangeRow,
    addManualExchangeRow,
    submitBatchExchangeOfficers
  };

  root.smartScannerUI = smartScannerUI;

  // Window bridge for inline onclick handlers & existing app.js calls
  root.openSmartScannerModal = openSmartScannerModal;
  root.closeSmartScannerModal = closeSmartScannerModal;
  root.updateScannerPreviewStarPoints = updateScannerPreviewStarPoints;
  root.handleScannerFiles = handleScannerFiles;
  root.handleScannerFileInput = handleScannerFileInput;
  root.displayScannerResults = displayScannerResults;
  root.applyScanResultsToProfile = applyScanResultsToProfile;
  root.initSmartScanner = initSmartScanner;

  root.openExchangeOcrModal = openExchangeOcrModal;
  root.closeExchangeOcrModal = closeExchangeOcrModal;
  root.initExchangeOcr = initExchangeOcr;
  root.handleExchangeFiles = handleExchangeFiles;
  root.handleExchangeFileInput = handleExchangeFileInput;
  root.renderExchangeOcrTable = renderExchangeOcrTable;
  root.recalcExchangeRowTotal = recalcExchangeRowTotal;
  root.removeExchangeRow = removeExchangeRow;
  root.addManualExchangeRow = addManualExchangeRow;
  root.submitBatchExchangeOfficers = submitBatchExchangeOfficers;

  // Auto-initialize when loaded in browser
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initSmartScanner();
        initExchangeOcr();
      });
    } else {
      initSmartScanner();
      initExchangeOcr();
    }
    window.addEventListener('load', () => {
      initSmartScanner();
      initExchangeOcr();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = smartScannerUI;
  }
})(typeof window !== 'undefined' ? window : globalThis);
