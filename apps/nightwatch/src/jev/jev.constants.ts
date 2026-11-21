import { JevLabel } from './jev.types';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export const JEV_LABELS: JevLabel[] = ['legitimate', 'account_takeover', 'uncertain'];

export const JEV_QUESTIONS = {
  takeover: {
    type: 'noul',
    instructions:
      'Is this banking session most likely operated by someone other than the account owner (account takeover)? Judge the current login in `request.session` against the owner\'s past logins in `request.history.recent_login_attempts`, using the precomputed `facts`.',
  },
  pattern: {
    type: 'choice',
    instructions: 'Which reading of this login fits best?',
    criteria: {
      legitimate: 'The owner logging in as usual, maybe on a new phone or while travelling.',
      account_takeover:
        'Someone else logged in with stolen credentials, a hijacked session or a deepfaked check.',
      uncertain: 'The evidence does not support either reading.',
    },
  },
};
