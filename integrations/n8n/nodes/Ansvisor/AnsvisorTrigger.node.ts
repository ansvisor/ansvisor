import type {
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { verifyAnsvisorWebhook } from './shared/webhookSignature';

const supportedEvents = new Set([
  'opportunity.sent',
  'daily_pulse.created',
  'action_task.sent',
  'content_draft.sent',
  'webhook.test',
]);

type RawWebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: Buffer;
  readRawBody?: () => Promise<void>;
};

export class AnsvisorTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Ansvisor Trigger',
    name: 'ansvisorTrigger',
    icon: 'fa:bell',
    group: ['trigger'],
    version: 1,
    description: 'Start a workflow when Ansvisor sends a brand webhook',
    defaults: { name: 'Ansvisor Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'ansvisorWebhookSecret', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'ansvisor',
      },
    ],
    properties: [
      {
        displayName: 'Webhook URL',
        name: 'webhookUrlNotice',
        type: 'notice',
        default: '',
        description:
          'Copy the Production URL after activating this workflow into the webhook URL for the matching Ansvisor brand.',
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return false;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject() as unknown as RawWebhookRequest;
    const response = this.getResponseObject();

    const reject = (statusCode: number): IWebhookResponseData => {
      response.writeHead(statusCode, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return { noWebhookResponse: true };
    };

    let credentials: { webhookSecret?: string };
    try {
      credentials = await this.getCredentials('ansvisorWebhookSecret');
    } catch {
      return reject(401);
    }

    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(401);

    const payload = body as Record<string, unknown>;
    const event = typeof payload.event === 'string' ? payload.event : '';
    if (!supportedEvents.has(event)) return reject(401);

    const receivedSecret = request.headers['x-webhook-secret'];
    const signature = request.headers['x-ansvisor-signature'];

    if (typeof receivedSecret !== 'string' || (signature !== undefined && typeof signature !== 'string')) {
      return reject(401);
    }

    let rawBody: Buffer | undefined;
    if (event === 'content_draft.sent') {
      try {
        if (!request.rawBody && request.readRawBody) {
          await request.readRawBody();
        }
      } catch {
        return reject(401);
      }
      if (Buffer.isBuffer(request.rawBody)) {
        rawBody = request.rawBody;
      }
    }

    const verified = verifyAnsvisorWebhook({
      event,
      secret: credentials.webhookSecret ?? '',
      receivedSecret,
      rawBody,
      signature: typeof signature === 'string' ? signature : undefined,
    });

    if (!verified) return reject(401);

    // Do not forward request headers: they contain the shared secret and signature.
    return {
      workflowData: [
        this.helpers.returnJsonArray([
          {
            event,
            payload,
          },
        ]),
      ],
    };
  }
}
