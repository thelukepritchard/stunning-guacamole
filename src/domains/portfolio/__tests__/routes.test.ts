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
import { getTraderProfile } from '../routes/get-trader-profile';
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
   * Tests for the getTraderProfile route handler.
   * Exercises username lookup via the username-index GSI and performance
   * snapshot retrieval for a configurable period.
   */
  describe('getTraderProfile', () => {
    /** Helper: build a mock PortfolioPerformanceRecord snapshot. */
    function makeSnapshot(ts: string, pnl24h: number): Record<string, unknown> {
      return {
        sub: 'user-abc',
        timestamp: ts,
        activeBots: 2,
        totalNetPnl: 1000 + pnl24h,
        totalRealisedPnl: 800,
        totalUnrealisedPnl: 200 + pnl24h,
        pnl24h,
        ttl: 9999999,
      };
    }

    /** Verifies 200 with full profile when username and snapshots are found (default 7d period). */
    it('returns 200 with the trader profile for the default 7d period', async () => {
      const snap1 = makeSnapshot('2026-01-01T00:00:00Z', 50);
      const snap2 = makeSnapshot('2026-01-02T00:00:00Z', 120);

      // First QueryCommand: GSI username lookup
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      // Second QueryCommand: performance snapshot range query
      mockSend.mockResolvedValueOnce({ Items: [snap1, snap2] });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.username).toBe('alice');
      expect(body.createdAt).toBe('2025-12-01T00:00:00Z');
      // Summary should reflect the latest (second) snapshot
      expect(body.summary).not.toBeNull();
      expect(body.summary.pnl24h).toBe(120);
      expect(body.summary.activeBots).toBe(2);
      expect(body.summary.lastUpdated).toBe('2026-01-02T00:00:00Z');
      // Performance array should have both snapshots mapped to public fields
      expect(body.performance).toHaveLength(2);
      expect(body.performance[0].timestamp).toBe('2026-01-01T00:00:00Z');
      expect(body.performance[1].timestamp).toBe('2026-01-02T00:00:00Z');
      // sub must not be exposed in the response
      expect(body.sub).toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies the 24h period param is accepted and results in a DDB query. */
    it('returns 200 for the 24h period query param', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: [makeSnapshot('2026-01-07T12:00:00Z', 30)] });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
        queryStringParameters: { period: '24h' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.performance).toHaveLength(1);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies the 30d period param is accepted. */
    it('returns 200 for the 30d period query param', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
        queryStringParameters: { period: '30d' },
      }));

      expect(result.statusCode).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    /** Verifies summary is null when no performance snapshots exist. */
    it('returns summary as null when the trader has no performance snapshots', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.summary).toBeNull();
      expect(body.performance).toEqual([]);
    });

    /** Verifies undefined Items on the performance query is handled gracefully. */
    it('handles undefined Items from the performance query as an empty array', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.summary).toBeNull();
      expect(body.performance).toEqual([]);
    });

    /** Verifies 404 is returned when the GSI returns no matching user. */
    it('returns 404 when the trader username does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'ghost' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Trader not found');
      // Should not issue a second DDB call for performance
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    /** Verifies 404 when the GSI Items array is undefined. */
    it('returns 404 when the GSI query returns undefined Items', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'ghost' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(404);
      expect(body.error).toBe('Trader not found');
    });

    /** Verifies 400 is returned when the username path param is missing. */
    it('returns 400 when username path param is missing', async () => {
      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: null,
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe('Missing username');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies 400 is returned for an unrecognised period value. */
    it('returns 400 for an invalid period query param', async () => {
      const result = await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
        queryStringParameters: { period: 'bad_period' },
      }));
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(body.error).toContain('Invalid period');
      expect(mockSend).not.toHaveBeenCalled();
    });

    /** Verifies the GSI QueryCommand uses the username-index and correct expression. */
    it('issues the GSI QueryCommand with the correct username-index parameters', async () => {
      const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
        QueryCommand: jest.Mock;
      };

      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-abc', username: 'alice', createdAt: '2025-12-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'alice' },
      }));

      // First call is the GSI lookup
      const firstCall = QueryCommand.mock.calls[0][0];
      expect(firstCall.IndexName).toBe('username-index');
      expect(firstCall.ExpressionAttributeValues[':username']).toBe('alice');
      expect(firstCall.Limit).toBe(1);
    });

    /** Verifies the performance QueryCommand uses the caller's sub from the GSI result. */
    it('queries performance snapshots using the sub resolved from the GSI', async () => {
      const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as {
        QueryCommand: jest.Mock;
      };

      mockSend.mockResolvedValueOnce({
        Items: [{ sub: 'user-xyz', username: 'bob', createdAt: '2025-11-01T00:00:00Z' }],
      });
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getTraderProfile(buildRouteEvent({
        resource: '/portfolio/leaderboard/{username}',
        pathParameters: { username: 'bob' },
      }));

      // Second call is the performance range query
      const secondCall = QueryCommand.mock.calls[1][0];
      expect(secondCall.ExpressionAttributeValues[':sub']).toBe('user-xyz');
      expect(secondCall.TableName).toBe('PortfolioPerformanceTable');
      expect(secondCall.ScanIndexForward).toBe(true);
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
