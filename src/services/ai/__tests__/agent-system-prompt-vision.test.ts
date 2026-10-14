/**
 * Vision-only prompt extraction (ADKSY — surgical extraction of the
 * photo-transfer fix from e634fc4bf9a07aad3a1466026fb21aaf864372b4,
 * without its bundled "free listing creation" feature).
 *
 * Source-level checks only — same established convention as
 * agent-route-security.test.ts (reads the source file as text rather than
 * importing it, since AiAgentService.ts's module graph pulls in
 * dependencies that don't resolve cleanly in this Vitest setup for a
 * plain import). These checks exist to prove two things that a behavioral
 * test cannot: (1) the new standalone Vision paragraph never references
 * any free-listing-creation tool or concept, and (2) the four pre-existing
 * free-listing-creation paragraphs are untouched — byte-for-byte identical
 * to their known-good reference text (the exact text already confirmed,
 * in this same audit, to match origin/main before this extraction).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const serviceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/services/ai/AiAgentService.ts'),
  'utf-8'
);

// Reference text for the four pre-existing free-listing-creation
// paragraphs — exactly as they read on origin/main before this
// extraction. Any future, legitimate change to these paragraphs (a real
// product decision about free listing creation) must update this
// reference deliberately — this test must never be satisfied by an
// accidental edit.
const REFERENCE_FREE_LISTING_PARAGRAPH =
  'Free listing creation — no sourcing required (AI-first listing workflow): sourcing is an entry point, never a mandatory gate for creating a listing. Distinguish the reseller\'s intent before acting: "trouve-moi des Nike Air Max à moins de 50 €" is SOURCING (call search_products); "crée-moi une annonce pour ma Prada Cut" / "génère-moi une annonce de A à Z pour X" — an item the reseller already owns, describing something to sell, not asking you to find one — is FREE LISTING CREATION; "j\'ai trouvé cette paire, crée-moi l\'annonce" (right after a search_products result) stays the SOURCED pipeline above; "modifie mon annonce X" is an edit_listing_draft/update_listing call on an existing draft/listing, never a new generate_listing_draft; "publie-la sur eBay" is the existing publish flow. When the reseller clearly already possesses the item and asks for a listing, NEVER call search_products first and NEVER say something like "je dois d\'abord trouver ce produit" — go straight to collecting what you need conversationally, then call generate_listing_draft WITHOUT a sourceUrl (its FREE mode).';

const REFERENCE_COLLECTING_INFO_PARAGRAPH =
  'Collecting information conversationally (AI-first "free listing creation" workflow): never present a giant form or ask for every field at once. Ask for what\'s genuinely missing, one question (or a small, natural group of simple ones) at a time, in plain conversational text — exactly like you already do for any other clarification, no special tool is needed to "ask a question": simply respond with text and wait for the next message. NEVER ask again for something the reseller already told you earlier in this conversation — re-read the conversation before asking. Indispensable facts (ask when missing and actually needed): what the item is (enough to write a title — category/brand/model as applicable), condition, size when applicable, photos when none exist yet, a purchase price when known/needed for a margin preview, and a selling price (or let the reseller ask you to propose one — see below). Optional facts (box, invoice, accessories, color, material, year, country of manufacture, extra defects, manufacturer reference, etc.): ask only if natural in the conversation, and if the reseller doesn\'t give one, simply leave it unset — NEVER invent it. This absolute rule has NO exception for this workflow: never guess or fabricate a purchase price, selling price, size, condition, color, material, accessories, box, invoice, defect, authenticity claim, dimension, purchase date, origin, SKU, or any other specific product fact. A detail you merely suspect from a photo is a HYPOTHESIS, never a fact — say so explicitly and ask the reseller to confirm it before treating it as real.';

const REFERENCE_PHOTOS_FREE_LISTING_PARAGRAPH =
  'Photos in free listing creation: ask for photos when none have been attached yet and the reseller hasn\'t said there are none. Real photos the reseller sends in the chat are uploaded via the product\'s own existing provenance system (tagged USER_UPLOADED once the product is actually created) — you never generate a substitute image instead of a real one the reseller is providing, and generate_listing_draft_image (AI-generated images) remains reserved for the SOURCED pipeline/explicit reseller request, never a stand-in for a missing real photo in this workflow. Once at least one real photo has been sent in this conversation, generate_listing_draft (FREE mode) and edit_listing_draft automatically attach it — you never need to pass an image yourself.';

const REFERENCE_PREPARING_FREE_DRAFT_PARAGRAPH =
  'Preparing the free draft and margin preview: once you have the indispensable facts (at minimum a title), call generate_listing_draft with NO sourceUrl and the fields the reseller actually gave you (title/brand/condition/size/color/material/model/proposedPrice) — never a value they didn\'t state. It returns a draftId: remember it and pass it back on every later edit_listing_draft/create_product call for this same item, exactly like you already do with sourceUrl for a sourced item. Use edit_listing_draft\'s patch for every later change (e.g. "mets plutôt 189 € et précise qu\'il y a la boîte" → one edit_listing_draft call changing only price and description) — never regenerate the draft from scratch for a small change. A free draft has no sourced purchase cost at all — once the reseller has told you their purchase price, use the existing calculate_margin tool (purchasePrice/purchaseCurrency + the draft\'s own proposed price) to show a margin preview; state plainly which part is the reseller\'s own figure, which is your proposal, and which (if any) is still only an estimate — marketplace/shipping/tax fees not yet known must be named as excluded, never silently folded into "profit".';

describe('AiAgentService system prompt — Vision paragraph is isolated from free listing creation', () => {
  it('the four pre-existing free-listing-creation paragraphs are byte-for-byte unchanged', () => {
    expect(serviceSource).toContain(REFERENCE_FREE_LISTING_PARAGRAPH);
    expect(serviceSource).toContain(REFERENCE_COLLECTING_INFO_PARAGRAPH);
    expect(serviceSource).toContain(REFERENCE_PHOTOS_FREE_LISTING_PARAGRAPH);
    expect(serviceSource).toContain(REFERENCE_PREPARING_FREE_DRAFT_PARAGRAPH);
  });

  it('adds a standalone Vision paragraph containing the anti-hallucination rule', () => {
    expect(serviceSource).toContain('Photos attached to any message — real visual analysis, with real limits');
    expect(serviceSource).toContain('never as a confirmed fact');
    expect(serviceSource).toContain('Never claim certainty about a brand, model, material, authenticity, or condition from a photo alone');
  });

  it('the Vision paragraph explicitly handles the unavailable status and partial-success case', () => {
    const paragraphStart = serviceSource.indexOf('Photos attached to any message — real visual analysis, with real limits');
    const paragraphEnd = serviceSource.indexOf('Preparing the free draft and margin preview:', paragraphStart);
    expect(paragraphStart).toBeGreaterThan(-1);
    expect(paragraphEnd).toBeGreaterThan(paragraphStart);
    const visionParagraph = serviceSource.slice(paragraphStart, paragraphEnd);

    expect(visionParagraph).toContain('can be marked unavailable');
    expect(visionParagraph).toContain('never claim to have seen, analyzed, or described a photo that the tool result marked unavailable');
    expect(visionParagraph).toContain('never treat a partial success');
  });

  it('the Vision paragraph never passes an unconfirmed visual deduction to a tool call or business action as an established fact', () => {
    const paragraphStart = serviceSource.indexOf('Photos attached to any message — real visual analysis, with real limits');
    const paragraphEnd = serviceSource.indexOf('Preparing the free draft and margin preview:', paragraphStart);
    const visionParagraph = serviceSource.slice(paragraphStart, paragraphEnd);

    expect(visionParagraph).toContain('Never pass your own visual impression into a tool call or any business action as if it were a reseller-confirmed fact');
  });

  it('the Vision paragraph never references any free-listing-creation tool or concept — proves it is genuinely standalone', () => {
    const paragraphStart = serviceSource.indexOf('Photos attached to any message — real visual analysis, with real limits');
    const paragraphEnd = serviceSource.indexOf('Preparing the free draft and margin preview:', paragraphStart);
    expect(paragraphStart).toBeGreaterThan(-1);
    const visionParagraph = serviceSource.slice(paragraphStart, paragraphEnd);

    expect(visionParagraph).not.toContain('generate_listing_draft');
    expect(visionParagraph).not.toContain('edit_listing_draft');
    expect(visionParagraph).not.toContain('draftId');
    expect(visionParagraph).not.toContain('create_product');
    expect(visionParagraph).not.toContain('FREE mode');
  });

  it('the Vision paragraph is placed after "Photos in free listing creation" and before "Preparing the free draft"', () => {
    const photosFreeListingIndex = serviceSource.indexOf('Photos in free listing creation:');
    const visionParagraphIndex = serviceSource.indexOf('Photos attached to any message — real visual analysis, with real limits');
    const preparingFreeDraftIndex = serviceSource.indexOf('Preparing the free draft and margin preview:');

    expect(photosFreeListingIndex).toBeGreaterThan(-1);
    expect(visionParagraphIndex).toBeGreaterThan(photosFreeListingIndex);
    expect(preparingFreeDraftIndex).toBeGreaterThan(visionParagraphIndex);
  });
});
