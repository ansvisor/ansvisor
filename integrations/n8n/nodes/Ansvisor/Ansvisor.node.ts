import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
  buildAnsvisorApiRequest,
  buildAnsvisorHttpRequest,
  type AnsvisorOperation,
  type AnsvisorResource,
} from './shared/apiRequest';

export class Ansvisor implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Ansvisor',
    name: 'ansvisor',
    icon: 'fa:chart-line',
    group: ['transform'],
    version: 1,
    description: 'Read brands and AI visibility metrics from Ansvisor',
    defaults: { name: 'Ansvisor' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'ansvisorApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Brand', value: 'brand' },
          { name: 'Visibility', value: 'visibility' },
          { name: 'Citations', value: 'citations' },
          { name: 'AI Traffic', value: 'aiTraffic' },
        ],
        default: 'brand',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: { show: { resource: ['brand'] } },
        options: [{ name: 'Get Many', value: 'getAll', action: 'Get many brands' }],
        default: 'getAll',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: { show: { resource: ['visibility'] } },
        options: [
          { name: 'Get Summary', value: 'getSummary', action: 'Get visibility summary' },
          { name: 'Get Trend', value: 'getTrend', action: 'Get visibility trend' },
        ],
        default: 'getSummary',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: { show: { resource: ['citations'] } },
        options: [{ name: 'Get', value: 'get', action: 'Get citations' }],
        default: 'get',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: { show: { resource: ['aiTraffic'] } },
        options: [{ name: 'Get', value: 'get', action: 'Get AI traffic' }],
        default: 'get',
      },
      {
        displayName: 'Brand',
        name: 'brandId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['visibility', 'citations', 'aiTraffic'] } },
        description: 'The brand ID returned by the Brand resource.',
      },
      {
        displayName: 'Date From',
        name: 'dateFrom',
        type: 'string',
        default: '',
        placeholder: '2026-01-01',
        displayOptions: { show: { resource: ['visibility', 'citations', 'aiTraffic'] } },
        description: 'Start date in YYYY-MM-DD format.',
      },
      {
        displayName: 'Date To',
        name: 'dateTo',
        type: 'string',
        default: '',
        placeholder: '2026-01-31',
        displayOptions: { show: { resource: ['visibility', 'citations', 'aiTraffic'] } },
        description: 'End date in YYYY-MM-DD format.',
      },
      {
        displayName: 'Granularity',
        name: 'granularity',
        type: 'options',
        displayOptions: {
          show: { resource: ['visibility'], operation: ['getTrend'] },
        },
        options: [
          { name: 'Day', value: 'day' },
          { name: 'Week', value: 'week' },
        ],
        default: 'day',
      },
      {
        displayName: 'Source Filter',
        name: 'sourceFilter',
        type: 'options',
        displayOptions: { show: { resource: ['citations'] } },
        options: [
          { name: 'All', value: 'all' },
          { name: 'Owned', value: 'owned' },
          { name: 'Competitor', value: 'competitor' },
          { name: 'External', value: 'external' },
        ],
        default: 'all',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 200 },
        displayOptions: { show: { resource: ['citations'] } },
        default: 50,
        description: 'Maximum number of citation rows (1–200).',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('ansvisorApi');
    const baseUrl = String(credentials.baseUrl || 'https://app.ansvisor.com');

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as AnsvisorResource;
        const operation = this.getNodeParameter('operation', itemIndex) as AnsvisorOperation;
        const request = buildAnsvisorApiRequest(resource, operation, {
          brandId: this.getNodeParameter('brandId', itemIndex, '') as string,
          dateFrom: this.getNodeParameter('dateFrom', itemIndex, '') as string,
          dateTo: this.getNodeParameter('dateTo', itemIndex, '') as string,
          granularity: this.getNodeParameter('granularity', itemIndex, 'day') as 'day' | 'week',
          sourceFilter: this.getNodeParameter('sourceFilter', itemIndex, 'all') as
            | 'all'
            | 'owned'
            | 'competitor'
            | 'external',
          limit: this.getNodeParameter('limit', itemIndex, 50) as number,
        });

        const requestOptions = buildAnsvisorHttpRequest(baseUrl, request);
        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'ansvisorApi',
          requestOptions,
        );

        output.push({
          json: response as INodeExecutionData['json'],
          pairedItem: { item: itemIndex },
        });
      } catch {
        if (this.continueOnFail()) {
          output.push({
            json: { error: 'Ansvisor API request failed. Check the API key, base URL and brand access.' },
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        throw new NodeOperationError(
          this.getNode(),
          'Ansvisor API request failed. Check the API key, base URL and brand access.',
          { itemIndex },
        );
      }
    }

    return [output];
  }
}
