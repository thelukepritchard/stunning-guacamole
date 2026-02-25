import type { APIGatewayProxyResult } from 'aws-lambda';

/** Mock return for route handlers. */
const mockResponse: APIGatewayProxyResult = {
  statusCode: 200,
  body: JSON.stringify({ ok: true }),
};

const mockListPortfolios = jest.fn().mockResolvedValue(mockResponse);
const mockCreatePortfolio = jest.fn().mockResolvedValue({ ...mockResponse, statusCode: 201 });
const mockGetPortfolio = jest.fn().mockResolvedValue(mockResponse);
const mockUpdatePortfolio = jest.fn().mockResolvedValue(mockResponse);
const mockDeletePortfolio = jest.fn().mockResolvedValue(mockResponse);
const mockGetPortfolioPerformance = jest.fn().mockResolvedValue(mockResponse);
const mockGetLeaderboard = jest.fn().mockResolvedValue(mockResponse);

jest.mock('../routes/list-portfolios', () => ({ listPortfolios: mockListPortfolios }));
jest.mock('../routes/create-portfolio', () => ({ createPortfolio: mockCreatePortfolio }));
jest.mock('../routes/get-portfolio', () => ({ getPortfolio: mockGetPortfolio }));
jest.mock('../routes/update-portfolio', () => ({ updatePortfolio: mockUpdatePortfolio }));
jest.mock('../routes/delete-portfolio', () => ({ deletePortfolio: mockDeletePortfolio }));
jest.mock('../routes/get-portfolio-performance', () => ({ getPortfolioPerformance: mockGetPortfolioPerformance }));
jest.mock('../routes/get-leaderboard', () => ({ getLeaderboard: mockGetLeaderboard }));

import { handler } from '../index';
import { buildEvent } from '../../test-utils';

/**
 * Tests for the portfolio domain Lambda handler route dispatch.
 * Verifies that each HTTP method + resource combination is routed
 * to the correct route handler, and that unknown routes return 404.
 */
describe('portfolio handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Verifies GET /portfolio dispatches to listPortfolios. */
  it('routes GET /portfolio to listPortfolios', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/portfolio' });

    const result = await handler(event);

    expect(mockListPortfolios).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies POST /portfolio dispatches to createPortfolio. */
  it('routes POST /portfolio to createPortfolio', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/portfolio',
      body: JSON.stringify({ name: 'Test' }),
    });

    const result = await handler(event);

    expect(mockCreatePortfolio).toHaveBeenCalledWith(event);
    expect(result.statusCode).toBe(201);
  });

  /** Verifies GET /portfolio/{id} dispatches to getPortfolio. */
  it('routes GET /portfolio/{id} to getPortfolio', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
    });

    const result = await handler(event);

    expect(mockGetPortfolio).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies PUT /portfolio/{id} dispatches to updatePortfolio. */
  it('routes PUT /portfolio/{id} to updatePortfolio', async () => {
    const event = buildEvent({
      httpMethod: 'PUT',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    const result = await handler(event);

    expect(mockUpdatePortfolio).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies DELETE /portfolio/{id} dispatches to deletePortfolio. */
  it('routes DELETE /portfolio/{id} to deletePortfolio', async () => {
    const event = buildEvent({
      httpMethod: 'DELETE',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
    });

    const result = await handler(event);

    expect(mockDeletePortfolio).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /portfolio/performance dispatches to getPortfolioPerformance. */
  it('routes GET /portfolio/performance to getPortfolioPerformance', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/portfolio/performance' });

    const result = await handler(event);

    expect(mockGetPortfolioPerformance).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies GET /portfolio/leaderboard dispatches to getLeaderboard. */
  it('routes GET /portfolio/leaderboard to getLeaderboard', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/portfolio/leaderboard' });

    const result = await handler(event);

    expect(mockGetLeaderboard).toHaveBeenCalledWith(event);
    expect(result).toBe(mockResponse);
  });

  /** Verifies that an unknown route returns a 404 response. */
  it('returns 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'PATCH', resource: '/portfolio' });

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
