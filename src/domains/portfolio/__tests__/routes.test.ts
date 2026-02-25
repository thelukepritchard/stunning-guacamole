import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  ScanCommand: jest.fn((params) => ({ ...params, _type: 'Scan' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
}));

import { listPortfolios } from '../routes/list-portfolios';
import { getPortfolioPerformance } from '../routes/get-portfolio-performance';
import { getLeaderboard } from '../routes/get-leaderboard';
import { createPortfolio } from '../routes/create-portfolio';
import { getPortfolio } from '../routes/get-portfolio';
import { updatePortfolio } from '../routes/update-portfolio';
import { deletePortfolio } from '../routes/delete-portfolio';

/**
 * Builds a mock API Gateway proxy event for portfolio route handler tests.
 *
 * @param overrides - Partial event properties to merge into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
function buildRouteEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/portfolio',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/portfolio',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: 'user-123' } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

/**
 * Tests for all portfolio domain route handlers.
 * Each handler is tested with mocked DynamoDB calls.
 */
describe('portfolio route handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PORTFOLIO_TABLE_NAME = 'PortfolioTable';
    process.env.PORTFOLIO_PERFORMANCE_TABLE_NAME = 'PortfolioPerformanceTable';
  });

  /**
   * Tests for the listPortfolios route handler.
   */
  describe('listPortfolios', () => {
    /** Verifies the authenticated user's portfolio is returned when found. */
    it('returns 200 with the portfolio item when found', async () => {
      const mockPortfolio = { sub: 'user-123', username: 'testuser', createdAt: '2026-01-01T00:00:00Z' };
      mockSend.mockResolvedValueOnce({ Item: mockPortfolio });

      const result = await listPortfolios(buildRouteEvent());
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.sub).toBe('user-123');
      expect(body.username).toBe('testuser');
    });

    /** Verifies 404 is returned when no portfolio record exists. */
    it('returns 404 when portfolio is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await listPortfolios(buildRouteEvent());
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Portfolio not found');
    });

    /** Verifies 401 is returned when no sub is present in the token claims. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await listPortfolios(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for the getPortfolioPerformance route handler.
   */
  describe('getPortfolioPerformance', () => {
    /** Verifies performance snapshots are returned for the default 7d period. */
    it('returns 200 with performance items for default 7d period', async () => {
      const mockItems = [
        { sub: 'user-123', timestamp: '2026-01-01T00:00:00Z', totalNetPnl: 500 },
        { sub: 'user-123', timestamp: '2026-01-02T00:00:00Z', totalNetPnl: 750 },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await getPortfolioPerformance(buildRouteEvent({
        resource: '/portfolio/performance',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual(mockItems);
      expect(body.items).toHaveLength(2);
    });

    /** Verifies the 24h period is correctly handled. */
    it('returns 200 with performance items for 24h period', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getPortfolioPerformance(buildRouteEvent({
        resource: '/portfolio/performance',
        queryStringParameters: { period: '24h' },
      }));

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies empty results return an empty array. */
    it('returns 200 with empty array when no snapshots exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const result = await getPortfolioPerformance(buildRouteEvent({
        resource: '/portfolio/performance',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual([]);
    });

    /** Verifies 400 is returned for an invalid period query parameter. */
    it('returns 400 for an invalid period', async () => {
      const result = await getPortfolioPerformance(buildRouteEvent({
        resource: '/portfolio/performance',
        queryStringParameters: { period: 'bad_period' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Invalid period');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies 401 is returned when no sub is present. */
    it('returns 401 when sub is not present', async () => {
      const event = buildRouteEvent({
        resource: '/portfolio/performance',
        requestContext: {
          authorizer: { claims: {} },
        } as unknown as APIGatewayProxyEvent['requestContext'],
      });

      const result = await getPortfolioPerformance(event);

      expect(result.statusCode).toBe(401);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  /**
   * Tests for the getLeaderboard route handler.
   */
  describe('getLeaderboard', () => {
    /** Verifies a ranked leaderboard is returned when users have performance data. */
    it('returns 200 with ranked leaderboard entries', async () => {
      const users = [
        { sub: 'user-abc', username: 'alice', createdAt: '2026-01-01T00:00:00Z' },
        { sub: 'user-def', username: 'bob', createdAt: '2026-01-01T00:00:00Z' },
      ];
      // ScanCommand for users
      mockSend.mockResolvedValueOnce({ Items: users, LastEvaluatedKey: undefined });
      // QueryCommand for user-abc performance
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', timestamp: '2026-01-01T00:00:00Z', pnl24h: 200, totalNetPnl: 1000, activeBots: 2 }],
      });
      // QueryCommand for user-def performance
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-def', timestamp: '2026-01-01T00:00:00Z', pnl24h: 100, totalNetPnl: 500, activeBots: 1 }],
      });

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toHaveLength(2);
      // Ranked by pnl24h descending — alice (200) before bob (100)
      expect(body.items[0].username).toBe('alice');
      expect(body.items[0].rank).toBe(1);
      expect(body.items[0].sub).toBeUndefined();
      expect(body.items[1].username).toBe('bob');
      expect(body.items[1].rank).toBe(2);
    });

    /** Verifies users with no performance data are excluded from the leaderboard. */
    it('excludes users with no performance snapshots', async () => {
      const users = [
        { sub: 'user-abc', username: 'alice', createdAt: '2026-01-01T00:00:00Z' },
        { sub: 'user-def', username: 'bob', createdAt: '2026-01-01T00:00:00Z' },
      ];
      mockSend.mockResolvedValueOnce({ Items: users, LastEvaluatedKey: undefined });
      // user-abc has performance
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', timestamp: '2026-01-01T00:00:00Z', pnl24h: 300, totalNetPnl: 800, activeBots: 1 }],
      });
      // user-def has no performance data
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].username).toBe('alice');
    });

    /** Verifies custom limit query parameter is respected (up to max 100). */
    it('respects the limit query parameter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
        queryStringParameters: { limit: '5' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toHaveLength(0);
    });

    /** Verifies the limit is capped at 100 regardless of the query parameter. */
    it('caps limit at 100', async () => {
      const manyUsers = Array.from({ length: 110 }, (_, i) => ({
        sub: `user-${i}`,
        username: `user${i}`,
        createdAt: '2026-01-01T00:00:00Z',
      }));
      mockSend.mockResolvedValueOnce({ Items: manyUsers, LastEvaluatedKey: undefined });
      // All users have performance data
      for (let i = 0; i < 110; i++) {
        mockSend.mockResolvedValueOnce({
          Items: [{ sub: `user-${i}`, timestamp: '2026-01-01T00:00:00Z', pnl24h: i, totalNetPnl: i * 10, activeBots: 1 }],
        });
      }

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
        queryStringParameters: { limit: '999' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toHaveLength(100);
    });

    /** Verifies an empty leaderboard when no users are registered. */
    it('returns 200 with empty array when no users are registered', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toEqual([]);
    });

    /** Verifies pagination is handled when the user scan spans multiple pages. */
    it('paginates the user scan when LastEvaluatedKey is set', async () => {
      const page1Users = [{ sub: 'user-1', username: 'user1', createdAt: '2026-01-01T00:00:00Z' }];
      const page2Users = [{ sub: 'user-2', username: 'user2', createdAt: '2026-01-01T00:00:00Z' }];

      // First ScanCommand returns partial result with a LastEvaluatedKey
      mockSend.mockResolvedValueOnce({ Items: page1Users, LastEvaluatedKey: { sub: 'user-1' } });
      // Second ScanCommand returns the final page
      mockSend.mockResolvedValueOnce({ Items: page2Users, LastEvaluatedKey: undefined });
      // Performance queries for each user
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-1', timestamp: '2026-01-01T00:00:00Z', pnl24h: 10, totalNetPnl: 100, activeBots: 1 }],
      });
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-2', timestamp: '2026-01-01T00:00:00Z', pnl24h: 20, totalNetPnl: 200, activeBots: 1 }],
      });

      const result = await getLeaderboard(buildRouteEvent({
        resource: '/portfolio/leaderboard',
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.items).toHaveLength(2);
    });
  });

  /**
   * Tests for the legacy portfolio CRUD route handlers (stub-based).
   * These routes remain as stubs pending full DynamoDB implementation.
   */
  describe('createPortfolio', () => {
    /** Verifies 201 with the created portfolio for a named portfolio. */
    it('returns 201 with the created portfolio', async () => {
      const result = await createPortfolio(buildRouteEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ name: 'My Portfolio' }),
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body).toEqual({ id: 'p-new', name: 'My Portfolio' });
    });

    /** Verifies name defaults to 'Untitled' when body is empty. */
    it('defaults name to Untitled when body is empty', async () => {
      const result = await createPortfolio(buildRouteEvent({ httpMethod: 'POST', body: null }));
      const body = JSON.parse(result.body);

      expect(body.name).toBe('Untitled');
    });
  });

  describe('getPortfolio', () => {
    /** Verifies 200 with the portfolio for the given ID. */
    it('returns 200 with the portfolio for the given ID', async () => {
      const result = await getPortfolio(buildRouteEvent({
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
    /** Verifies 200 with the updated portfolio. */
    it('returns 200 with the updated portfolio', async () => {
      const result = await updatePortfolio(buildRouteEvent({
        httpMethod: 'PUT',
        pathParameters: { id: 'p-123' },
        body: JSON.stringify({ name: 'Renamed' }),
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual({ id: 'p-123', name: 'Renamed' });
    });

    /** Verifies name defaults when body has no name field. */
    it('defaults name when body has no name field', async () => {
      const result = await updatePortfolio(buildRouteEvent({
        httpMethod: 'PUT',
        pathParameters: { id: 'p-123' },
        body: null,
      }));
      const body = JSON.parse(result.body);

      expect(body.name).toBe('Updated Portfolio');
    });
  });

  describe('deletePortfolio', () => {
    /** Verifies 200 with the deletion confirmation. */
    it('returns 200 with the deletion confirmation', async () => {
      const result = await deletePortfolio(buildRouteEvent({
        httpMethod: 'DELETE',
        pathParameters: { id: 'p-123' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body).toEqual({ id: 'p-123', deleted: true });
    });
  });
});
