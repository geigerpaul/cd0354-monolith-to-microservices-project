import {Router, Request, Response} from 'express';
import {FeedItem} from '../models/FeedItem';
import {NextFunction} from 'connect';
import * as jwt from 'jsonwebtoken';
import * as AWS from '../../../../aws';
import * as c from '../../../../config/config';

const router: Router = Router();

export function requireAuth(req: Request, res: Response, next: NextFunction) {

  if (!req.headers || !req.headers.authorization) {
    return res.status(401).send({message: 'No authorization headers.'});
  }

  const tokenBearer = req.headers.authorization.split(' ');
  if (tokenBearer.length != 2) {
    return res.status(401).send({message: 'Malformed token.'});
  }

  const token = tokenBearer[1];
  return jwt.verify(token, c.config.jwt.secret, (err) => {
    if (err) {
      return res.status(500).send({auth: false, message: 'Failed to authenticate.'});
    }
    return next();
  });
}

// Get all feed items with logging and error handling
router.get('/', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] GET /feed requested`);

  try {
    console.log(`[${new Date().toISOString()}] Fetching feed items from DB...`);
    const items = await FeedItem.findAndCountAll({ order: [['id', 'DESC']] });

    console.log(`[${new Date().toISOString()}] Mapping signed URLs for ${items.count} items...`);
    const itemsWithUrls = await Promise.all(items.rows.map(async (item) => {
      try {
        if (item.url) {
          item.url = await AWS.getGetSignedUrl(item.url);
        }
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error signing URL for item ${item.id}:`, err);
      }
      return item;
    }));

    console.log(`[${new Date().toISOString()}] Sending response with ${itemsWithUrls.length} items`);
    res.status(200).send({ count: items.count, rows: itemsWithUrls });

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error in GET /feed:`, err);
    res.status(500).send({ error: 'Failed to fetch feed items' });
  }
});

// Get a feed resource
router.get('/:id',
    async (req: Request, res: Response) => {
      const {id} = req.params;
      const item = await FeedItem.findByPk(id);
      res.send(item);
    });

// Get a signed url to put a new item in the bucket
router.get('/signed-url/:fileName',
  requireAuth,
  async (req: Request, res: Response) => {
    const {fileName} = req.params;
    const url = await AWS.getPutSignedUrl(fileName);
    res.status(201).send({url: url});
  });

// Create feed with metadata
router.post('/',
    requireAuth,
    async (req: Request, res: Response) => {
      const caption = req.body.caption;
      const fileName = req.body.url; // same as S3 key name
      if (!caption) {
        return res.status(400).send({message: 'Caption is required or malformed.'});
      }

      if (!fileName) {
        return res.status(400).send({message: 'File url is required.'});
      }

      const item = await new FeedItem({
        caption: caption,
        url: fileName,
      });

      const savedItem = await item.save();
      savedItem.url = await AWS.getGetSignedUrl(savedItem.url);
      res.status(201).send(savedItem);
    });

export const FeedRouter: Router = router;
