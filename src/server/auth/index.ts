// Public exports for the agent / match token layer.

export {
  type AgentCredentialAuthorization,
  authorizeAgentCredential,
  deleteAgentCredential,
  generateAgentSecret,
  hashAgentSecret,
  isValidAgentSecret,
} from './agent-credential';
export {
  AGENT_TOKEN_DEFAULT_TTL_MS,
  AGENT_TOKEN_KIND,
  type AgentTokenPayload,
  extractBearerToken,
  issueAgentToken,
  isValidAgentPlayerKey,
  verifyAgentToken,
} from './agent-token';
export {
  hashAgentToken,
  issueMatchToken,
  MATCH_TOKEN_DEFAULT_TTL_MS,
  MATCH_TOKEN_KIND,
  type MatchTokenPayload,
  verifyMatchToken,
} from './match-token';
export {
  hasValidOAuthAccessClaims,
  issueOAuthAccessToken,
  OAUTH_ACCESS_TOKEN_KIND,
  OAUTH_ACCESS_TOKEN_TTL_MS,
  type OAuthAccessTokenPayload,
  verifyOAuthAccessToken,
} from './oauth-access-token';
export {
  isAgentTokenSecretSet,
  MissingAgentTokenSecretError,
  resolveAgentTokenSecret,
} from './secret';
export {
  type SignedTokenPayload,
  signToken,
  type VerifyResult,
  verifyToken,
} from './tokens';
