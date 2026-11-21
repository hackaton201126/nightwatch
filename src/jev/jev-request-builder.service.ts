import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { Facts } from '../facts/facts.types';
import { JEV_QUESTIONS } from './jev.constants';
import { JevBody } from './jev.types';

@Injectable()
export class JevRequestBuilderService {
  constructor(private readonly config: AppConfigService) {}

  /** The body of the Jev request: the bank's webhook as is, the computed facts and the two questions. */
  build(request: unknown, facts: Facts): JevBody {
    return { model: this.config.jev().jev.model, state: { request, facts }, questions: JEV_QUESTIONS };
  }

  /** The transaction id of the request, or '' when it has none. */
  transactionId(request: unknown): string {
    const id = (request as { transaction?: { transaction_id?: unknown } } | null)?.transaction?.transaction_id;
    return typeof id === 'string' ? id : '';
  }
}
