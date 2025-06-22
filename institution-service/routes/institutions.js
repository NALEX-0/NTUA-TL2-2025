// routes/institutions.js
// Διαχείριση ιδρυμάτων & διαχείριση credits (tokens) με Sequelize
const express = require('express');
const { institutions, sequelize } = require('../models');  // Φορτώνουμε τα μοντέλα και το Sequelize instance
const router = express.Router();

/**
 * GET /institutions
 * Επιστρέφει όλα τα ιδρύματα με id, όνομα και τρέχον υπόλοιπο tokens
 */
router.get('/', async (req, res) => {
  try {
    console.log('[DEBUG] Fetching all institutions');
    const rows = await institutions.findAll({
      attributes: ['id', 'name', 'tokens']
    });
    return res.json(rows);
  } catch (err) {
    console.error('[ERROR] GET /institutions failed:', err);
    return res.status(500).json({ error: 'Database error fetching institutions' });
  }
});

/**
 * POST /institutions
 * Δημιουργεί νέο ίδρυμα με αρχικό υπόλοιπο tokens = 0
 */
router.post('/', async (req, res) => {
  const { name, address, contactEmail } = req.body;
  try {
    console.log('[DEBUG] Creating institution:', name);
    const newInst = await institutions.create({
      name,
      address,
      contactEmail,
      tokens: 0
    });
    // Επιστρέφουμε λεπτομέρειες του νέου ιδρύματος
    return res.status(201).json(newInst);
  } catch (err) {
    console.error('[ERROR] POST /institutions failed:', err);
    return res.status(500).json({ error: 'Database error creating institution' });
  }
});

/**
 * GET /institutions/:institutionId
 * Επιστρέφει ένα ίδρυμα βάσει πρωτεύοντος κλειδιού
 */
router.get('/:institutionId', async (req, res) => {
  const id = req.params.institutionId;
  try {
    console.log(`[DEBUG] Fetching institution ${id}`);
    const inst = await institutions.findByPk(id, {
      attributes: ['id', 'name', 'tokens']
    });
    if (!inst) {
      return res.status(404).json({ error: 'Institution not found' });
    }
    return res.json(inst);
  } catch (err) {
    console.error(`[ERROR] GET /institutions/${id} failed:`, err);
    return res.status(500).json({ error: 'Database error fetching institution' });
  }
});

/**
 * DELETE /institutions/:institutionId
 * Διαγράφει ένα ίδρυμα (και όλα τα tokens του)
 */
router.delete('/:institutionId', async (req, res) => {
  const id = req.params.institutionId;
  try {
    console.log(`[DEBUG] Deleting institution ${id}`);
    const deleted = await institutions.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ error: 'Institution not found' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error(`[ERROR] DELETE /institutions/${id} failed:`, err);
    return res.status(500).json({ error: 'Database error deleting institution' });
  }
});

/**
 * GET /institutions/:institutionId/credits
 * Επιστρέφει το τρέχον υπόλοιπο tokens
 */
router.get('/:institutionId/credits', async (req, res) => {
  const id = req.params.institutionId;
  try {
    console.log(`[DEBUG] Getting credits for institution ${id}`);
    const inst = await institutions.findByPk(id, { attributes: ['tokens'] });
    if (!inst) {
      return res.status(404).json({ error: 'Institution not found' });
    }
    return res.json({ institutionId: id, creditBalance: inst.tokens });
  } catch (err) {
    console.error(`[ERROR] GET /institutions/${id}/credits failed:`, err);
    return res.status(500).json({ error: 'Database error fetching credits' });
  }
});

/**
 * POST /institutions/:institutionId/credits/purchase
 * Αύξηση tokens κατά το amount (π.χ. αγορά credits)
 */
router.post('/:institutionId/credits/purchase', async (req, res) => {
  const id = req.params.institutionId;
  const { amount } = req.body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  try {
    console.log(`[DEBUG] Purchasing ${amount} credits for ${id}`);
    // Χρήση convenience μεθόδου Sequelize για atomic increment
    await institutions.increment('tokens', { by: amount, where: { id } });
    const inst = await institutions.findByPk(id, { attributes: ['tokens'] });
    return res.json({ creditBalance: inst.tokens });
  } catch (err) {
    console.error(`[ERROR] POST /institutions/${id}/credits/purchase failed:`, err);
    return res.status(500).json({ error: 'Database error purchasing credits' });
  }
});

/**
 * POST /institutions/:institutionId/credits/consume
 * Μείωση tokens κατά το amount (π.χ. κατανάλωση credit μετά upload)
 */
router.post('/:institutionId/credits/consume', async (req, res) => {
  const id = req.params.institutionId;
  const { amount } = req.body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  try {
    console.log(`[DEBUG] Consuming ${amount} credits for ${id}`);
    // Βεβαιωνόμαστε ότι υπάρχει αρκετό υπόλοιπο σε ένα transaction
    await sequelize.transaction(async (t) => {
      const inst = await institutions.findByPk(id, { transaction: t });
      if (!inst) throw new Error('NOT_FOUND');
      if (inst.tokens < amount) throw new Error('NO_CREDITS');
      await inst.decrement('tokens', { by: amount, transaction: t });
    });
    const updated = await institutions.findByPk(id, { attributes: ['tokens'] });
    return res.json({ remainingCredits: updated.tokens });
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Institution not found' });
    }
    if (err.message === 'NO_CREDITS') {
      return res.status(403).json({ error: 'Insufficient credits' });
    }
    console.error(`[ERROR] POST /institutions/${id}/credits/consume failed:`, err);
    return res.status(500).json({ error: 'Database error consuming credits' });
  }
});

module.exports = router;
