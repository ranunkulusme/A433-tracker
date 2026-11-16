/**
 * KoW Tracker - Deep Module: Officer Progression & Warehouse Deductor
 *
 * Encapsulates atomic officer level/star/skill promotions with warehouse
 * resource checks, stock deduction, and audit log generation.
 * Zero external dependencies.
 */

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const out = skills.slice(0, 4).map(v => Math.max(1, Math.min(5, Number(v) || 1)));
  while (out.length < 4) out.push(1);
  return out;
}

function sanitizeInvested(invested) {
  if (!invested || typeof invested !== 'object') return null;
  return {
    coupons: Math.max(0, Number(invested.coupons) || 0),
    puzzles: Math.max(0, Number(invested.puzzles) || 0),
    starCoupons: Math.max(0, Number(invested.starCoupons) || 0),
    legendaryStars1: Math.max(0, Number(invested.legendaryStars1) || 0),
    legendaryStars2: Math.max(0, Number(invested.legendaryStars2) || 0),
    legendaryStars3: Math.max(0, Number(invested.legendaryStars3) || 0)
  };
}

function sanitizePersonalPuzzles(puz) {
  return Math.max(0, Math.floor(Number(puz) || 0));
}

function createOfficerProgression({ db, logic }) {
  if (!db) throw new Error('db is required for OfficerProgression');
  if (!logic) throw new Error('logic is required for OfficerProgression');

  /**
   * Adds an officer to player roster with optional atomic warehouse deduction
   */
  function addOfficer(playerId, officerPayload, options = {}) {
    const player = db.getPlayerById(playerId);
    if (!player) {
      return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор игрока не найден' };
    }

    const isRetro = Boolean(options.isRetro);
    const userId = options.userId || player.userId || null;
    const body = { ...officerPayload };

    if (body.skills !== undefined) {
      body.skills = sanitizeSkills(body.skills);
    }
    if (body.invested !== undefined) {
      body.invested = sanitizeInvested(body.invested);
    }
    if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
      body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
    }
    if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
      body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
    }

    const catalog = db.getCatalog ? db.getCatalog() : [];
    const cat = catalog.find(c => c.id === (body.catalogId || body.officerId || body.id));

    let initialDeduction = null;
    const shouldDeduct = !isRetro && Boolean(options.deductStock) && player.stock;

    if (shouldDeduct && typeof logic.calculateInitialOfficerStockDeduction === 'function') {
      initialDeduction = logic.calculateInitialOfficerStockDeduction({
        officer: body,
        stock: player.stock,
        catalogOfficer: cat,
        isRetrospective: false
      });

      if (!initialDeduction.canAfford) {
        return {
          ok: false,
          status: 400,
          error: 'INSUFFICIENT_STOCK',
          message: initialDeduction.error || 'Недостаточно ресурсов на складе для прокачки офицера',
          deficit: initialDeduction
        };
      }

      if (initialDeduction.invested) {
        body.invested = sanitizeInvested(initialDeduction.invested);
      }
    }

    // 1. Save officer in DB
    const off = db.addPlayerOfficer(playerId, body);

    // 2. If stock deduction applies, deduct atomically and record audit history
    let newStock = player.stock;
    let stockDeducted = false;

    if (initialDeduction && initialDeduction.deductStock && initialDeduction.newStock) {
      newStock = initialDeduction.newStock;
      stockDeducted = true;
      const now = new Date().toISOString();
      const diff = logic.calculateStockDiff(player.stock, newStock);

      db.updatePlayer(playerId, {
        stock: newStock,
        stockUpdatedAt: now,
        stockUpdateSource: 'officer_progression',
        recordHistory: false
      });

      db.recordStockHistory({
        playerId,
        userId,
        source: 'manual_edit',
        snapshotBefore: player.stock,
        snapshotAfter: newStock,
        diffSummary: `Добавлен офицер «${off?.name || cat?.name || 'Офицер'}» (${diff.summary || 'прокачка звезд/навыков'})`,
        screenshotPath: null,
        createdAt: now
      });
    }

    return {
      ok: true,
      officer: off,
      newStock,
      stockDeducted
    };
  }

  /**
   * Updates an existing officer with optional atomic warehouse deduction
   */
  function updateOfficer(playerId, officerId, officerPayload, options = {}) {
    const player = db.getPlayerById(playerId);
    if (!player) {
      return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор игрока не найден' };
    }

    const pOfficers = Array.isArray(player.officers) ? player.officers : [];
    const oldOff = pOfficers.find(o => String(o.id) === String(officerId));
    if (!oldOff) {
      return { ok: false, status: 404, error: 'OFFICER_NOT_FOUND', message: 'Офицер не найден' };
    }

    const isRetro = Boolean(options.isRetro);
    const userId = options.userId || player.userId || null;
    const body = { ...officerPayload };

    if (body.skills !== undefined) {
      body.skills = sanitizeSkills(body.skills);
    }
    if (body.invested !== undefined) {
      body.invested = sanitizeInvested(body.invested);
    }
    if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
      body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
    }
    if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
      body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
    }

    const catalog = db.getCatalog ? db.getCatalog() : [];
    const cat = catalog.find(c => c.id === (oldOff.catalogId || oldOff.officerId || oldOff.id || body.catalogId));

    let stockDeducted = false;
    let newStock = player.stock;
    let newInvested = oldOff.invested;

    const shouldDeduct = !isRetro && Boolean(options.deductStock) && player.stock;

    if (shouldDeduct) {
      const rawCost = Number(cat?.couponPerPuzzle);
      const costPerPuzzle = rawCost === 0 ? (cat?.upgradeType === 'special' ? 0 : 500) : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
      const upgradeType = cat?.upgradeType || 'standard';
      const starCouponCost = cat?.starCouponCost || (cat?.generation === 7 ? 300 : (cat?.generation <= 6 ? 250 : 360));
      const maxMedals = (cat && (cat.medalsBeforeTraining || cat.medals_before_training)) || 690;

      let curStock = { ...player.stock };
      let curInv = logic.normalizeInvested ? logic.normalizeInvested(oldOff.invested) : { ...(oldOff.invested || {}) };
      let hasChanges = false;

      // 1. Level change
      const targetLevel = body.level !== undefined ? Number(body.level) : oldOff.level;
      if (oldOff.level !== undefined && targetLevel !== undefined && oldOff.level !== targetLevel) {
        if (typeof logic.calculateLevelStockDelta === 'function') {
          const lRes = logic.calculateLevelStockDelta(oldOff.level, targetLevel, curStock, costPerPuzzle, upgradeType, curInv);
          if (!lRes.canAfford) {
            return {
              ok: false,
              status: 400,
              error: 'INSUFFICIENT_STOCK',
              message: `Недостаточно ресурсов на складе для изменения уровня (не хватает ${lRes.deficitPuzzles || 0} пазл.)`,
              deficit: lRes
            };
          }
          curStock.coupons = Math.max(0, (curStock.coupons || 0) + (lRes.delta.coupons || 0));
          curStock.puzzles = Math.max(0, (curStock.puzzles || 0) + (lRes.delta.puzzles || 0));
          if (lRes.newInvested) curInv = lRes.newInvested;
          hasChanges = true;
        }
      }

      // 2. Stars change
      const targetStars = body.stars !== undefined ? Number(body.stars) : Number(oldOff.stars || 0);
      const oldStars = Number(oldOff.stars || 0);
      if (oldStars !== targetStars) {
        if (typeof logic.calculateStarStockDelta === 'function') {
          const sRes = logic.calculateStarStockDelta(oldStars, targetStars, curStock, starCouponCost, curInv);
          if (!sRes.canAfford) {
            return {
              ok: false,
              status: 400,
              error: 'INSUFFICIENT_STOCK',
              message: 'Недостаточно ресурсов на складе для изменения звёзд',
              deficit: sRes
            };
          }
          curStock.starCoupons = Math.max(0, (curStock.starCoupons || 0) + (sRes.delta.starCoupons || 0));
          curStock.legendaryStars1 = Math.max(0, (curStock.legendaryStars1 || 0) + (sRes.delta.legendaryStars1 || 0));
          curStock.legendaryStars2 = Math.max(0, (curStock.legendaryStars2 || 0) + (sRes.delta.legendaryStars2 || 0));
          curStock.legendaryStars3 = Math.max(0, (curStock.legendaryStars3 || 0) + (sRes.delta.legendaryStars3 || 0));
          if (sRes.newInvested) curInv = sRes.newInvested;
          hasChanges = true;
        }
      }

      // 3. Skills change
      const targetSkills = body.skills !== undefined ? body.skills : oldOff.skills;
      const oldSkills = Array.isArray(oldOff.skills) && oldOff.skills.length === 4 ? oldOff.skills : [1, 1, 1, 1];
      const hasSkillDiff = Array.isArray(targetSkills) && targetSkills.some((s, idx) => s !== oldSkills[idx]);
      if (hasSkillDiff) {
        if (typeof logic.calculateSkillStockDelta === 'function') {
          const skRes = logic.calculateSkillStockDelta(oldSkills, targetSkills, curStock, costPerPuzzle, upgradeType, maxMedals, curInv);
          if (!skRes.canAfford) {
            return {
              ok: false,
              status: 400,
              error: 'INSUFFICIENT_STOCK',
              message: `Недостаточно ресурсов на складе для изменения навыков (не хватает ${skRes.deficitMedals || 0} медалей)`,
              deficit: skRes
            };
          }
          curStock.coupons = Math.max(0, (curStock.coupons || 0) + (skRes.delta.coupons || 0));
          curStock.puzzles = Math.max(0, (curStock.puzzles || 0) + (skRes.delta.puzzles || 0));
          if (skRes.newInvested) curInv = skRes.newInvested;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        newStock = curStock;
        newInvested = curInv;
        body.invested = sanitizeInvested(newInvested);
        stockDeducted = true;
      }
    }

    const updated = db.updatePlayerOfficer(playerId, officerId, body);
    if (!updated) {
      return { ok: false, status: 404, error: 'OFFICER_NOT_FOUND', message: 'Офицер не найден' };
    }

    if (stockDeducted) {
      const now = new Date().toISOString();
      const diff = logic.calculateStockDiff(player.stock, newStock);

      db.updatePlayer(playerId, {
        stock: newStock,
        stockUpdatedAt: now,
        stockUpdateSource: 'officer_progression',
        recordHistory: false
      });

      db.recordStockHistory({
        playerId,
        userId,
        source: 'manual_edit',
        snapshotBefore: player.stock,
        snapshotAfter: newStock,
        diffSummary: `Прокачка офицера «${updated.name || cat?.name || 'Офицер'}» (${diff.summary || 'изменение характеристик'})`,
        screenshotPath: null,
        createdAt: now
      });
    }

    return {
      ok: true,
      officer: updated,
      newStock,
      stockDeducted
    };
  }

  /**
   * Deletes an officer from player roster
   */
  function deleteOfficer(playerId, officerId) {
    db.deletePlayerOfficer(playerId, officerId);
    return { ok: true };
  }

  return {
    addOfficer,
    updateOfficer,
    deleteOfficer,
    sanitizeSkills,
    sanitizeInvested,
    sanitizePersonalPuzzles
  };
}

module.exports = {
  createOfficerProgression,
  sanitizeSkills,
  sanitizeInvested,
  sanitizePersonalPuzzles
};
