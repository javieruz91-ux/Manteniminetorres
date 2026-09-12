import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, visitPhotosTable, visitsTable } from '@workspace/db';
import { Router, type IRouter, type Request, type Response } from 'express';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

class UploadMetadataConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadMetadataConflictError';
  }
}

function hasAuthenticatedSession(
  req: Request,
): req is Request & {
  isAuthenticated: () => boolean;
  user: NonNullable<Request['user']>;
} {
  if (
    !('isAuthenticated' in req) ||
    typeof req.isAuthenticated !== 'function'
  ) {
    return false;
  }

  return req.isAuthenticated();
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });

      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const {
        name,
        size,
        contentType,
        visitId,
        sectionId,
        pointId,
        findingId,
        type,
        localId,
      } = parsed.data;

      const [existingVisit] = await db
        .select({ ownerId: visitsTable.ownerId })
        .from(visitsTable)
        .where(eq(visitsTable.visitId, visitId));
      if (existingVisit && existingVisit.ownerId !== req.user.id) {
        res.status(403).json({ error: 'Visit belongs to another user' });
        return;
      }

      const allocation = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${req.user.id}:${visitId}:${localId}`}))`,
        );
        const [existingPhoto] = await tx
          .select()
          .from(visitPhotosTable)
          .where(
            and(
              eq(visitPhotosTable.ownerId, req.user.id),
              eq(visitPhotosTable.visitId, visitId),
              eq(visitPhotosTable.localId, localId),
            ),
          );
        if (
          existingPhoto &&
          (existingPhoto.sectionId !== (sectionId ?? null) ||
            existingPhoto.pointId !== (pointId ?? null) ||
            existingPhoto.findingId !== (findingId ?? null) ||
            existingPhoto.type !== type ||
            existingPhoto.contentType !== contentType ||
            existingPhoto.size !== size)
        ) {
          throw new UploadMetadataConflictError(
            'Photo upload metadata cannot be reassigned',
          );
        }
        if (existingPhoto?.objectPath) {
          return {
            objectPath: existingPhoto.objectPath,
            uploadURL: null,
          };
        }
        const uploadURL = await objectStorageService.getObjectEntityUploadURL();
        const objectPath =
          objectStorageService.normalizeObjectEntityPath(uploadURL);
        if (existingPhoto) {
          await tx
            .update(visitPhotosTable)
            .set({
              sectionId: sectionId ?? null,
              pointId: pointId ?? null,
              findingId: findingId ?? null,
              type,
              objectPath,
              uploadStatus: 'pending',
              contentType,
              size,
              updatedAt: new Date(),
            })
            .where(eq(visitPhotosTable.id, existingPhoto.id));
        } else {
          await tx.insert(visitPhotosTable).values({
            ownerId: req.user.id,
            visitId,
            sectionId: sectionId ?? null,
            pointId: pointId ?? null,
            findingId: findingId ?? null,
            type,
            localId,
            objectPath,
            uploadStatus: 'pending',
            contentType,
            size,
          });
        }
        return { objectPath, uploadURL };
      });
      const uploadURL =
        allocation.uploadURL ??
        (await objectStorageService.getObjectEntityUploadURLForPath(
          allocation.objectPath,
        ));
      const objectPath = allocation.objectPath;

      if (!objectPath || !uploadURL) {
        res.status(500).json({ error: 'Failed to allocate upload path' });
        return;
      }

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: {
            name,
            size,
            contentType,
            visitId,
            sectionId,
            pointId,
            findingId,
            type,
            localId,
          },
        }),
      );
    } catch (error) {
      if (error instanceof UploadMetadataConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  if (!hasAuthenticatedSession(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);
    const [photo] = await db
      .select({
        ownerId: visitPhotosTable.ownerId,
        uploadStatus: visitPhotosTable.uploadStatus,
      })
      .from(visitPhotosTable)
      .where(
        and(
          eq(visitPhotosTable.objectPath, objectPath),
          eq(visitPhotosTable.ownerId, req.user.id),
        ),
      );
    if (!photo || photo.uploadStatus !== 'uploaded') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
