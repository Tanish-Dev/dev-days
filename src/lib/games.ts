import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

/** Optional category and publisher constraints for game-list queries. */
export interface GameFilters {
    /** Match games belonging to any of these category IDs. */
    categoryIds?: number[];
    /** Match games published by this publisher ID. */
    publisherId?: number;
}

/** Page and filter options for paginated game-list queries. */
export interface GamePaginationOptions extends GameFilters {
    /** One-based page number. */
    page: number;
    /** Maximum number of games returned per page. */
    limit: number;
}

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database, filters: GameFilters = {}) {
    const conditions = [];
    if (filters.categoryIds && filters.categoryIds.length > 0) {
        conditions.push(inArray(games.categoryId, filters.categoryIds));
    }
    if (filters.publisherId !== undefined) {
        conditions.push(eq(games.publisherId, filters.publisherId));
    }

    const query = db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id))
        .$dynamic();

    return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

/**
 * Returns games ordered by title, optionally filtered by category and publisher.
 *
 * @param db Injectable application or in-memory database.
 * @param filters Optional category and publisher constraints.
 * @returns Matching games with their category and publisher details.
 */
export async function getAllGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const rows = await baseGamesQuery(db, filters).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns one deterministic page of games, optionally filtered by category and publisher.
 *
 * @param db Injectable application or in-memory database.
 * @param options One-based page and limit together with optional game filters.
 * @returns The games in the requested page, ordered by title.
 */
export async function getPaginatedGames(
    db: Database,
    options: GamePaginationOptions,
): Promise<Game[]> {
    const page = Math.max(1, Math.floor(options.page));
    const limit = Math.max(1, Math.floor(options.limit));
    const rows = await baseGamesQuery(db, options)
        .orderBy(asc(games.title))
        .limit(limit)
        .offset((page - 1) * limit);
    return rows.map(mapGame);
}

/**
 * Counts games matching optional category and publisher filters.
 *
 * @param db Injectable application or in-memory database.
 * @param filters Optional category and publisher constraints.
 * @returns The number of matching games.
 */
export async function getGameCount(db: Database, filters: GameFilters = {}): Promise<number> {
    const conditions = [];
    if (filters.categoryIds && filters.categoryIds.length > 0) {
        conditions.push(inArray(games.categoryId, filters.categoryIds));
    }
    if (filters.publisherId !== undefined) {
        conditions.push(eq(games.publisherId, filters.publisherId));
    }

    const query = db.select({ count: count() }).from(games).$dynamic();
    const row = conditions.length > 0 ? await query.where(and(...conditions)).get() : await query.get();
    return row?.count ?? 0;
}

/**
 * Returns all game IDs ordered by title.
 *
 * @param db Injectable application or in-memory database.
 * @returns Game IDs in deterministic title order.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Finds a single game by ID.
 *
 * @param db Injectable application or in-memory database.
 * @param id Game ID to look up.
 * @returns The matching game, or null when it does not exist.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
