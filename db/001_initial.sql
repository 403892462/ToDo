BEGIN;

CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE spaces IS '匿名个人任务空间';
COMMENT ON COLUMN spaces.id IS '个人空间唯一标识';
COMMENT ON COLUMN spaces.created_at IS '个人空间创建时间';

CREATE TABLE IF NOT EXISTS access_credentials (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT access_credentials_revocation_order CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
COMMENT ON TABLE access_credentials IS '个人空间访问码凭证';
COMMENT ON COLUMN access_credentials.id IS '访问码凭证唯一标识';
COMMENT ON COLUMN access_credentials.space_id IS '所属个人空间唯一标识';
COMMENT ON COLUMN access_credentials.secret_hash IS '访问码安全校验值，不保存访问码明文';
COMMENT ON COLUMN access_credentials.created_at IS '访问码凭证创建时间';
COMMENT ON COLUMN access_credentials.revoked_at IS '访问码凭证失效时间，空值表示仍有效';
CREATE UNIQUE INDEX IF NOT EXISTS access_credentials_one_active_per_space
  ON access_credentials (space_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS space_sessions (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT space_sessions_expiry_order CHECK (expires_at > created_at)
);
COMMENT ON TABLE space_sessions IS '浏览器个人空间授权会话';
COMMENT ON COLUMN space_sessions.id IS '空间授权会话唯一标识';
COMMENT ON COLUMN space_sessions.space_id IS '已授权的个人空间唯一标识';
COMMENT ON COLUMN space_sessions.token_hash IS '会话令牌安全校验值，不保存令牌明文';
COMMENT ON COLUMN space_sessions.created_at IS '会话创建时间';
COMMENT ON COLUMN space_sessions.expires_at IS '会话过期时间';
COMMENT ON COLUMN space_sessions.revoked_at IS '会话撤销时间，空值表示未撤销';
CREATE INDEX IF NOT EXISTS space_sessions_space_id_idx ON space_sessions (space_id);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  scheduled_at timestamptz,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  priority text CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE tasks IS '个人空间中的任务';
COMMENT ON COLUMN tasks.id IS '任务唯一标识';
COMMENT ON COLUMN tasks.space_id IS '所属个人空间唯一标识';
COMMENT ON COLUMN tasks.title IS '任务名称';
COMMENT ON COLUMN tasks.scheduled_at IS '任务计划开始时间，空值表示未排期';
COMMENT ON COLUMN tasks.duration_minutes IS '任务预计持续分钟数';
COMMENT ON COLUMN tasks.parent_id IS '父任务唯一标识，用于 AI 拆解产生的子任务';
COMMENT ON COLUMN tasks.priority IS '任务优先级：low 低、medium 中、high 高';
COMMENT ON COLUMN tasks.tags IS '任务标签 JSON 数组';
COMMENT ON COLUMN tasks.completed IS '任务是否已完成';
COMMENT ON COLUMN tasks.created_at IS '任务创建时间';
COMMENT ON COLUMN tasks.updated_at IS '任务最后更新时间';
CREATE INDEX IF NOT EXISTS tasks_space_schedule_idx ON tasks (space_id, scheduled_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT admin_sessions_expiry_order CHECK (expires_at > created_at)
);
COMMENT ON TABLE admin_sessions IS '管理员恢复操作授权会话';
COMMENT ON COLUMN admin_sessions.id IS '管理员会话唯一标识';
COMMENT ON COLUMN admin_sessions.token_hash IS '管理员会话令牌安全校验值，不保存令牌明文';
COMMENT ON COLUMN admin_sessions.created_at IS '管理员会话创建时间';
COMMENT ON COLUMN admin_sessions.expires_at IS '管理员会话过期时间';
COMMENT ON COLUMN admin_sessions.revoked_at IS '管理员会话撤销时间，空值表示未撤销';

CREATE TABLE IF NOT EXISTS authentication_attempts (
  scope text NOT NULL CHECK (scope IN ('space_restore', 'admin_login')),
  subject_hash text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  PRIMARY KEY (scope, subject_hash)
);
COMMENT ON TABLE authentication_attempts IS '空间恢复和管理员登录的防暴力尝试状态';
COMMENT ON COLUMN authentication_attempts.scope IS '认证范围：space_restore 空间恢复、admin_login 管理员登录';
COMMENT ON COLUMN authentication_attempts.subject_hash IS '认证对象的不可逆标识值';
COMMENT ON COLUMN authentication_attempts.failure_count IS '当前统计窗口内的失败次数';
COMMENT ON COLUMN authentication_attempts.window_started_at IS '失败次数统计窗口开始时间';
COMMENT ON COLUMN authentication_attempts.locked_until IS '禁止继续尝试的截止时间，空值表示未锁定';

CREATE TABLE IF NOT EXISTS recovery_audits (
  id uuid PRIMARY KEY,
  target_space_id uuid,
  attempted_space_id text NOT NULL,
  result text NOT NULL CHECK (result IN ('succeeded', 'space_not_found', 'database_failed')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE recovery_audits IS '管理员重置空间访问码的审计记录';
COMMENT ON COLUMN recovery_audits.id IS '恢复审计记录唯一标识';
COMMENT ON COLUMN recovery_audits.target_space_id IS '实际目标空间唯一标识，目标不存在时为空';
COMMENT ON COLUMN recovery_audits.attempted_space_id IS '管理员提交的目标空间标识文本';
COMMENT ON COLUMN recovery_audits.result IS '恢复结果：成功、空间不存在或数据库失败';
COMMENT ON COLUMN recovery_audits.occurred_at IS '恢复操作发生时间';
CREATE INDEX IF NOT EXISTS recovery_audits_occurred_at_idx ON recovery_audits (occurred_at DESC);

COMMIT;
