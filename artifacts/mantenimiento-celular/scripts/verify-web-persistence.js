const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const baseUrl = (process.env.WEB_TEST_URL || `https://${process.env.REPLIT_EXPO_DEV_DOMAIN || ''}`).replace(/\/+$/, '');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

function responseInput(page, fieldId) {
  return page.locator(`[data-testid="response-${fieldId}"]`);
}

async function waitForVisible(page, selector, timeout = 20_000) {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch (error) {
    if (selector.includes('status-')) {
      console.error('Status diagnostics:', {
        url: page.url(),
        body: (await page.locator('body').innerText()).slice(0, 3000),
        testIds: await page.locator('[data-testid]').evaluateAll(nodes =>
          nodes.map(node => node.getAttribute('data-testid')).filter(Boolean).slice(-80),
        ),
      });
    }
    throw error;
  }
  return locator;
}

async function main() {
  assert.ok(baseUrl.startsWith('http'), 'WEB_TEST_URL or REPLIT_EXPO_DEV_DOMAIN is required');
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('web-persistence-test-initialized')) {
        localStorage.clear();
        sessionStorage.setItem('web-persistence-test-initialized', '1');
      }
    });
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForVisible(page, '[data-testid="btn-start-visit"]');

    const catalog = await page.evaluate(async () => {
      const response = await fetch('/api/templates/trial-local');
      if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
      return response.json();
    });
    const fields = catalog.fields || catalog.catalog || [];
    const presentation = fields.find(field =>
      field.sheet === 'PRESENTACION' && field.role === 'presentation',
    );
    const siteName = fields.find(field =>
      field.sheet === 'PRESENTACION' && /nombre.*sitio/i.test(field.label),
    );
    const question = fields.find(field =>
      field.role === 'question' && field.sheet === 'ELECTROMECANICA',
    );
    assert.ok(presentation && siteName && question, 'Expected presentation and question fields are missing');

    await page.getByTestId('btn-start-visit').click();
    await page.waitForURL(/\/visit\/[^/]+$/, { timeout: 20_000 });
    const visitUrl = page.url();
    const visitId = visitUrl.match(/\/visit\/([^/]+)$/)?.[1];
    assert.ok(visitId, 'Visit id was not found after creation');

    await (await responseInput(page, presentation.id)).fill('PRUEBA-PERSISTENCIA');
    await (await responseInput(page, siteName.id)).fill('SITIO-PERSISTENTE');
    await page.getByTestId('sheet-ELECTROMECANICA').click();
    const sectionChip = page.getByTestId(`section-${question.section}`);
    if (await sectionChip.count()) await sectionChip.click();
    await page.getByTestId('field-search').fill(question.label);
    await waitForVisible(page, '[data-testid^="question-card-"]');
    const firstOkStatus = page.locator('[data-testid^="status-"][data-testid$="-OK"]').first();
    const firstOkStatusId = await firstOkStatus.getAttribute('data-testid');
    const questionId = firstOkStatusId.replace(/^status-/, '').replace(/-OK$/, '');
    await firstOkStatus.click();

    await page.getByText('Guardar y continuar después', { exact: true }).click();
    await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForVisible(page, '[data-testid^="visit-card-"]');
    await page.locator('[data-testid^="visit-card-"]').first().click();
    await page.waitForURL(/\/visit\/[^/]+$/, { timeout: 20_000 });
    assert.equal(await (await responseInput(page, presentation.id)).inputValue(), 'PRUEBA-PERSISTENCIA');
    assert.equal(await (await responseInput(page, siteName.id)).inputValue(), 'SITIO-PERSISTENTE');

    await page.getByTestId('sheet-ELECTROMECANICA').click();
    const reopenedSectionChip = page.getByTestId(`section-${question.section}`);
    if (await reopenedSectionChip.count()) await reopenedSectionChip.click();
    await page.getByTestId('field-search').fill(question.label);
    await waitForVisible(page, `[data-testid="status-${questionId}-OK"]`);
    await page.getByTestId(`status-${questionId}-NOK`).click();
    await waitForVisible(page, `[data-testid="btn-finding-${questionId}"]`);
    await page.getByTestId(`btn-finding-${questionId}`).click();
    await page.waitForURL(new RegExp(`/visit/${visitId}/finding/`), { timeout: 20_000 });
    await page.getByTestId('finding-description').fill('Descripción NOK persistente');
    await page.getByTestId('finding-responsible').fill('Responsable persistente');
    await page.getByTestId('finding-commitment-date').fill('2026-09-15');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('photo-library-ANTES').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'evidencia-persistente.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Qf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Qf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8Qf//Z',
      ),
    });
    await waitForVisible(page, '[data-testid="btn-save-finding"]');
    await page.getByTestId('btn-save-finding').click();
    await page.waitForURL(new RegExp(`/visit/${visitId}$`), { timeout: 20_000 });
    await page.getByText('Guardar y continuar después', { exact: true }).click();
    await page.waitForURL(url => new URL(url).pathname === '/', { timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForVisible(page, '[data-testid^="visit-card-"]');
    await page.locator('[data-testid^="visit-card-"]').first().click();
    await page.waitForURL(/\/visit\/[^/]+$/, { timeout: 20_000 });
    assert.equal(await (await responseInput(page, presentation.id)).inputValue(), 'PRUEBA-PERSISTENCIA');
    const progressText = await page.locator('body').innerText();
    assert.match(progressText, /Progreso de preguntas reales/);
    assert.match(progressText, /\b1\/263\b/);
    assert.match(progressText, /Campos capturables en el formato: 728/);
    assert.doesNotMatch(progressText, /728 preguntas reales/);

    await context.setOffline(true);
    await page.getByTestId('sheet-ELECTROMECANICA').click();
    const offlineSectionChip = page.getByTestId(`section-${question.section}`);
    if (await offlineSectionChip.count()) await offlineSectionChip.click();
    await page.getByTestId('field-search').fill(question.label);
    await waitForVisible(page, `[data-testid="btn-finding-${questionId}"]`);
    await page.getByTestId(`btn-finding-${questionId}`).click();
    await page.waitForURL(new RegExp(`/visit/${visitId}/finding/`), { timeout: 20_000 });
    await waitForVisible(page, '[data-testid="finding-description"]');
    assert.equal(await page.getByTestId('finding-description').inputValue(), 'Descripción NOK persistente');
    assert.equal(await page.locator('[data-testid^="evidence-photo-"]').count(), 1);
    console.log('Web persistence verification passed: text, selection/status, NOK description/photo, reload, and offline recovery.');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});