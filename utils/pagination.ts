import { Types } from 'mongoose';

export interface CursorPaginationOptions {
  limit?: number;
  cursor?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  maxLimit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor: string | null;
    previousCursor: string | null;
    totalCount?: number;
  };
}

/**
 * Build MongoDB query with cursor-based pagination
 * @param options Pagination options
 * @returns Query filters and pagination info
 */
export function buildCursorQuery(options: CursorPaginationOptions) {
  const {
    limit = 20,
    cursor,
    sortField = 'createdAt',
    sortDirection = 'desc',
    maxLimit = 100
  } = options;

  // Enforce reasonable limits
  const effectiveLimit = Math.min(Math.max(1, limit), maxLimit);
  const sortDir = sortDirection === 'asc' ? 1 : -1;
  
  const query: any = {};
  
  if (cursor) {
    try {
      // Decode cursor (base64 encoded ObjectId or timestamp)
      const cursorValue = Buffer.from(cursor, 'base64').toString('ascii');
      
      if (sortField === '_id') {
        // For _id sorting, use ObjectId comparison
        if (Types.ObjectId.isValid(cursorValue)) {
          query._id = sortDirection === 'desc' 
            ? { $lt: new Types.ObjectId(cursorValue) }
            : { $gt: new Types.ObjectId(cursorValue) };
        }
      } else {
        // For other fields (like createdAt), parse as date or use raw value
        let parsedValue: any = cursorValue;
        
        // Try to parse as date if it looks like a date
        if (sortField.includes('At') || sortField.includes('Date')) {
          const dateValue = new Date(cursorValue);
          if (!isNaN(dateValue.getTime())) {
            parsedValue = dateValue;
          }
        }
        
        query[sortField] = sortDirection === 'desc'
          ? { $lt: parsedValue }
          : { $gt: parsedValue };
      }
    } catch (error) {
      // Invalid cursor, ignore it
      console.warn('Invalid cursor provided:', cursor, error);
    }
  }
  
  return {
    query,
    limit: effectiveLimit,
    sort: { [sortField]: sortDir }
  };
}

/**
 * Generate cursor from document
 * @param doc Document to generate cursor from
 * @param sortField Field used for sorting
 * @returns Base64 encoded cursor
 */
export function generateCursor(doc: any, sortField: string = 'createdAt'): string {
  if (!doc) return '';
  
  let cursorValue: string;
  
  if (sortField === '_id') {
    cursorValue = doc._id.toString();
  } else {
    const fieldValue = doc[sortField];
    if (fieldValue instanceof Date) {
      cursorValue = fieldValue.toISOString();
    } else {
      cursorValue = String(fieldValue);
    }
  }
  
  return Buffer.from(cursorValue).toString('base64');
}

/**
 * Apply cursor pagination to a Mongoose query
 * @param Model Mongoose model
 * @param baseQuery Base query filters
 * @param options Pagination options
 * @param populateOptions Optional populate configuration
 * @returns Paginated results
 */
export async function paginateQuery<T>(
  Model: any,
  baseQuery: any = {},
  options: CursorPaginationOptions = {},
  populateOptions?: string | any[] | Record<string, any>
): Promise<PaginatedResult<T>> {
  const {
    sortField = 'createdAt',
    sortDirection = 'desc'
  } = options;
  
  const { query: cursorQuery, limit, sort } = buildCursorQuery(options);
  
  // Combine base query with cursor query
  const finalQuery = { ...baseQuery, ...cursorQuery };
  
  // Build the mongoose query
  let mongooseQuery = Model.find(finalQuery)
    .sort(sort)
    .limit(limit + 1) // Fetch one extra to check for next page
    .lean();
  
  // Apply population if provided
  if (populateOptions) {
    if (typeof populateOptions === 'string') {
      mongooseQuery = mongooseQuery.populate(populateOptions);
    } else if (Array.isArray(populateOptions)) {
      populateOptions.forEach(pop => {
        mongooseQuery = mongooseQuery.populate(pop);
      });
    } else {
      // Single populate object (e.g. { path, select, match, options })
      mongooseQuery = mongooseQuery.populate(populateOptions as any);
    }
  }
  
  const docs = await mongooseQuery;
  
  // Check if there's a next page
  const hasNextPage = docs.length > limit;
  if (hasNextPage) {
    docs.pop(); // Remove the extra document
  }
  
  // Generate cursors
  const nextCursor = hasNextPage && docs.length > 0
    ? generateCursor(docs[docs.length - 1], sortField)
    : null;
  
  const previousCursor = docs.length > 0
    ? generateCursor(docs[0], sortField)
    : null;
  
  return {
    data: docs as T[],
    pagination: {
      hasNextPage,
      hasPreviousPage: !!options.cursor, // If cursor was provided, there's a previous page
      nextCursor,
      previousCursor,
    }
  };
}

/**
 * Enhanced pagination with total count (more expensive but useful for UI)
 * @param Model Mongoose model
 * @param baseQuery Base query filters
 * @param options Pagination options
 * @param populateOptions Optional populate configuration
 * @returns Paginated results with total count
 */
export async function paginateQueryWithCount<T>(
  Model: any,
  baseQuery: any = {},
  options: CursorPaginationOptions = {},
  populateOptions?: string | any[] | Record<string, any>
): Promise<PaginatedResult<T>> {
  const result = await paginateQuery<T>(Model, baseQuery, options, populateOptions);
  
  // Get total count (expensive operation)
  const totalCount = await Model.countDocuments(baseQuery);
  
  return {
    ...result,
    pagination: {
      ...result.pagination,
      totalCount
    }
  };
}

/**
 * Parse pagination parameters from request query
 * @param query Request query parameters
 * @returns Parsed pagination options
 */
export function parsePaginationParams(query: any): CursorPaginationOptions {
  return {
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    cursor: query.cursor ? String(query.cursor) : undefined,
    sortField: query.sortField ? String(query.sortField) : undefined,
    sortDirection: query.sortDirection === 'asc' ? 'asc' : 'desc'
  };
}