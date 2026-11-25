/**
 * KoW Tracker - Deep Module: Officer Progression & Warehouse Deductor
 *
 * Encapsulates atomic officer level/star/skill promotions with warehouse
 * resource checks, stock deduction, and audit log generation.
 * Zero external dependencies.
 */

const defaultLogic = require('../shared/logic.js');

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const out = skills.slice(0, 4).map(v => Math.max(1, Math.min(5, Math.floor(Number(v) || 1))));
  while (out.length < 4) out.push(1);
  return out;
}

function sanitizeInvested(invested, logicRef = defaultLogic) {
  if (!invested || typeof invested !== 'object') return null;
  if (logicRef && typeof logicRef.normalizeInvested === 'function') {
    return logicRef.normalizeInvested(invested);
  }
  return defaultLogic.normalizeInvested(invested);
}

function sanitizePersonalPuzzles(puz) {
  const num = parseInt(puz, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

function sanitizeOfficerPayload(officerData = {}, logicRef = defaultLogic) {
  if (!officerData || typeof officerData !== 'object') return officerData;
  const out = { ...officerData };
  if (out.skills !== undefined) {
    out.skills = sanitizeSkills(out.skills);
  }
  if (out.invested !== undefined) {
    out.invested = sanitizeInvested(out.invested, logicRef);
  }
  if (out.personalPuzzles !== undefined || out.personal_puzzles !== undefined) {
    out.personalPuzzles = sanitizePersonalPuzzles(out.personalPuzzles ?? out.personal_puzzles);
  }
  if (out.onlyPersonalPuzzles !== undefined || out.only_personal_puzzles !== undefined) {
    out.onlyPersonalPuzzles = Boolean(out.onlyPersonalPuzzles ?? out.only_personal_puzzles);
  }
  return out;
}

function normalizeOfficersPayload(officers = [], logicRef = defaultLogic) {
  if (!Array.isArray(officers)) return [];
  return officers.map(o => sanitizeOfficerPayload(o, logicRef));
}

function createOfficerProgression({ db, logic }) {
  if (!db) throw new Error('db is required for OfficerProgression');
  const sharedLogic = logic || defaultLogic;

  function runInTransaction(fn) {
    if (typeof db.withTransaction === 'function') {
      return db.withTransaction(fn);
    }
    return fn();
  }

  function resolveParams(cat) {
    if (typeof sharedLogic.resolveOfficerUpgradeParams === 'function') {
      return sharedLogic.resolveOfficerUpgradeParams(cat);
    }
    return defaultLogic.resolveOfficerUpgradeParams(cat);
  }

  function commitStockDelta(playerId, userId, prevStock, newStock, diffSummary) {
    const now = new Date().toISOString();
    const diff = sharedLogic.calculateStockDiff(prevStock, newStock);

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
      snapshotBefore: prevStock,
      snapshotAfter: newStock,
      diffSummary: diffSummary || diff.summary || 'Изменение склада',
      screenshotPath: null,
      createdAt: now
    });

    return { now, diff };
  }

  /**
   * Adds an officer to player roster with atomic warehouse deduction
   */
  function addOfficer(playerId, officerPayload, options = {}) {
    return runInTransaction(() => {
      const player = db.getPlayerById(playerId);
      if (!player) {
        return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор игрока не найден' };
      }

      const isRetro = Boolean(options.isRetro);
      const userId = options.userId || player.userId || null;
      const body = sanitizeOfficerPayload(officerPayload, sharedLogic);

      const catalog = db.getCatalog ? db.getCatalog() : [];
      const cat = catalog.find(c => c.id === (body.catalogId || body.officerId || body.id));

      let initialDeduction = null;
      const shouldDeduct = !isRetro && Boolean(options.deductStock) && player.stock;

      if (shouldDeduct && typeof sharedLogic.calculateInitialOfficerStockDeduction === 'function') {
        initialDeduction = sharedLogic.calculateInitialOfficerStockDeduction({
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
          body.invested = sanitizeInvested(initialDeduction.invested, sharedLogic);
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
        const diff = sharedLogic.calculateStockDiff(player.stock, newStock);
        commitStockDelta(
          playerId,
          userId,
          player.stock,
          newStock,
          `Добавлен офицер «${off?.name || cat?.name || 'Офицер'}» (${diff.summary || 'прокачка звезд/навыков'})`
        );
      }

      return {
        ok: true,
        officer: off,
        newStock,
        stockDeducted
      };
    });
  }

  /**
   * Updates an existing officer with atomic warehouse deduction/rollback or full reset
   */
  function updateOfficer(playerId, officerId, officerPayload, options = {}) {
    return runInTransaction(() => {
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
      const body = sanitizeOfficerPayload(officerPayload, sharedLogic);

      const catalog = db.getCatalog ? db.getCatalog() : [];
      const cat = catalog.find(c => c.id === (oldOff.catalogId || oldOff.officerId || oldOff.id || body.catalogId));

      // Handle explicit atomic reset-to-stock operation
      if (body.reset === true) {
        const resetRes = typeof sharedLogic.calculateOfficerStockReset === 'function'
          ? sharedLogic.calculateOfficerStockReset({ officer: oldOff, stock: player.stock || {}, catalogOfficer: cat })
          : null;
        if (!resetRes) {
          return { ok: false, status: 500, error: 'RESET_NOT_SUPPORTED', message: 'Сброс не поддерживается' };
        }
        const updatedResetOff = db.updatePlayerOfficer(playerId, officerId, {
          ...resetRes.resetOfficer,
          invested: resetRes.newInvested
        });
        let newStock = player.stock;
        let stockRefunded = false;
        if (player.stock) {
          const diff = sharedLogic.calculateStockDiff(player.stock, resetRes.newStock);
          if (diff.summary && diff.summary !== 'Без изменений') {
            newStock = resetRes.newStock;
            stockRefunded = true;
            commitStockDelta(
              playerId,
              userId,
              player.stock,
              newStock,
              `Сброс офицера «${updatedResetOff?.name || cat?.name || 'Офицер'}» в сток (${diff.summary})`
            );
          }
        }
        return {
          ok: true,
          officer: updatedResetOff,
          newStock,
          stockDeducted: false,
          stockRefunded,
          resetDelta: resetRes.delta
        };
      }

      let stockDeducted = false;
      let newStock = player.stock;
      const shouldDeduct = !isRetro && Boolean(options.deductStock) && player.stock;

      if (shouldDeduct) {
        const { costPerPuzzle, upgradeType, starCouponCost, maxMedals } = resolveParams(cat);
        let curStock = { ...player.stock };
        let curInv = sharedLogic.normalizeInvested
          ? sharedLogic.normalizeInvested(oldOff.invested)
          : { ...(oldOff.invested || {}) };
        let hasChanges = false;

        // 1. Level change
        const targetLevel = body.level !== undefined ? Number(body.level) : oldOff.level;
        if (oldOff.level !== undefined && targetLevel !== undefined && oldOff.level !== targetLevel) {
          if (typeof sharedLogic.calculateLevelStockDelta === 'function') {
            const lRes = sharedLogic.calculateLevelStockDelta(oldOff.level, targetLevel, curStock, costPerPuzzle, upgradeType, curInv);
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
          if (typeof sharedLogic.calculateStarStockDelta === 'function') {
            const sRes = sharedLogic.calculateStarStockDelta(oldStars, targetStars, curStock, starCouponCost, curInv);
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
          if (typeof sharedLogic.calculateSkillStockDelta === 'function') {
            const skRes = sharedLogic.calculateSkillStockDelta(oldSkills, targetSkills, curStock, costPerPuzzle, upgradeType, maxMedals, curInv);
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
          body.invested = sanitizeInvested(curInv, sharedLogic);
          stockDeducted = true;
        }
      }

      const updated = db.updatePlayerOfficer(playerId, officerId, body);
      if (!updated) {
        return { ok: false, status: 404, error: 'OFFICER_NOT_FOUND', message: 'Офицер не найден' };
      }

      if (stockDeducted) {
        const diff = sharedLogic.calculateStockDiff(player.stock, newStock);
        commitStockDelta(
          playerId,
          userId,
          player.stock,
          newStock,
          `Прокачка офицера «${updated.name || cat?.name || 'Офицер'}» (${diff.summary || 'изменение характеристик'})`
        );
      }

      return {
        ok: true,
        officer: updated,
        newStock,
        stockDeducted
      };
    });
  }

  /**
   * Deletes an officer from player roster, optionally refunding invested resources atomically
   */
  function deleteOfficer(playerId, officerId, options = {}) {
    return runInTransaction(() => {
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
      const shouldRefund = Boolean(options.refundStock) && !isRetro && Boolean(player.stock);
      const userId = options.userId || player.userId || null;

      let newStock = player.stock;
      let stockRefunded = false;

      if (shouldRefund && typeof sharedLogic.calculateOfficerStockReset === 'function') {
        const catalog = db.getCatalog ? db.getCatalog() : [];
        const cat = catalog.find(c => c.id === (oldOff.catalogId || oldOff.officerId || oldOff.id));
        const resetRes = sharedLogic.calculateOfficerStockReset({
          officer: oldOff,
          stock: player.stock,
          catalogOfficer: cat
        });
        const diff = sharedLogic.calculateStockDiff(player.stock, resetRes.newStock);
        db.deletePlayerOfficer(playerId, officerId);
        if (diff.summary && diff.summary !== 'Без изменений') {
          newStock = resetRes.newStock;
          stockRefunded = true;
          commitStockDelta(
            playerId,
            userId,
            player.stock,
            newStock,
            `Удаление офицера «${oldOff.name || cat?.name || 'Офицер'}» (возврат на склад: ${diff.summary})`
          );
        }
      } else {
        db.deletePlayerOfficer(playerId, officerId);
      }

      return {
        ok: true,
        deletedId: officerId,
        newStock,
        stockRefunded
      };
    });
  }

  return {
    addOfficer,
    updateOfficer,
    deleteOfficer,
    sanitizeSkills,
    sanitizeInvested: (inv) => sanitizeInvested(inv, sharedLogic),
    sanitizePersonalPuzzles,
    sanitizeOfficerPayload: (o) => sanitizeOfficerPayload(o, sharedLogic),
    normalizeOfficersPayload: (arr) => normalizeOfficersPayload(arr, sharedLogic)
  };
}

module.exports = {
  createOfficerProgression,
  sanitizeSkills,
  sanitizeInvested,
  sanitizePersonalPuzzles,
  sanitizeOfficerPayload,
  normalizeOfficersPayload
};
