import { buildEvent } from '../../test-utils';
import { listPortfolios } from '../routes/list-portfolios';
import { createPortfolio } from '../routes/create-portfolio';
import { getPortfolio } from '../routes/get-portfolio';
import { updatePortfolio } from '../routes/update-portfolio';
import { deletePortfolio } from '../routes/delete-portfolio';

describe('listPortfolios', () => {
  it('returns 200 with an items array', async () => {
    const result = await listPortfolios(buildEvent());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('includes id and name on each item', async () => {
    const result = await listPortfolios(buildEvent());
    const body = JSON.parse(result.body);

    for (const item of body.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
    }
  });
});

describe('createPortfolio', () => {
  it('returns 201 with the created portfolio', async () => {
    const result = await createPortfolio(buildEvent({
      body: JSON.stringify({ name: 'My Portfolio' }),
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body).toEqual({ id: 'p-new', name: 'My Portfolio' });
  });

  it('defaults name to Untitled when body is empty', async () => {
    const result = await createPortfolio(buildEvent({ body: null }));
    const body = JSON.parse(result.body);

    expect(body.name).toBe('Untitled');
  });
});

describe('getPortfolio', () => {
  it('returns 200 with the portfolio for the given ID', async () => {
    const result = await getPortfolio(buildEvent({
      pathParameters: { id: 'p-123' },
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('p-123');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('holdings');
  });
});

describe('updatePortfolio', () => {
  it('returns 200 with the updated portfolio', async () => {
    const result = await updatePortfolio(buildEvent({
      pathParameters: { id: 'p-123' },
      body: JSON.stringify({ name: 'Renamed' }),
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({ id: 'p-123', name: 'Renamed' });
  });

  it('defaults name when body has no name field', async () => {
    const result = await updatePortfolio(buildEvent({
      pathParameters: { id: 'p-123' },
      body: null,
    }));
    const body = JSON.parse(result.body);

    expect(body.name).toBe('Updated Portfolio');
  });
});

describe('deletePortfolio', () => {
  it('returns 200 with the deletion confirmation', async () => {
    const result = await deletePortfolio(buildEvent({
      pathParameters: { id: 'p-123' },
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({ id: 'p-123', deleted: true });
  });
});
