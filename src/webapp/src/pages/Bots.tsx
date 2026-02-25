import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import BarChartIcon from '@mui/icons-material/BarChart';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { QueryBuilder, type RuleGroupType } from 'react-querybuilder';
import { QueryBuilderMaterial } from '@react-querybuilder/material';
import { botFields } from '../data/botFields';
import { tradingPairs, type BotStatus, type ExecutionMode } from '../data/mockData';
import { useApi } from '../hooks/useApi';
import { colors } from '@shared/styles/tokens';

/** API bot record shape. */
interface ApiBotRecord {
  sub: string;
  botId: string;
  name: string;
  pair: string;
  status: BotStatus;
  executionMode: ExecutionMode;
  buyQuery?: RuleGroupType;
  sellQuery?: RuleGroupType;
  cooldownMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

/** Status chip colour mapping. */
const statusColor: Record<BotStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  paused: 'warning',
  draft: 'default',
};

/** Count rules recursively in a query group. */
function countRules(group: RuleGroupType): number {
  let count = 0;
  for (const rule of group.rules) {
    if ('rules' in rule) {
      count += countRules(rule as RuleGroupType);
    } else {
      count += 1;
    }
  }
  return count;
}

/** Count total rules across optional buy and sell queries. */
function countBotRules(bot: ApiBotRecord): number {
  let total = 0;
  if (bot.buyQuery) total += countRules(bot.buyQuery);
  if (bot.sellQuery) total += countRules(bot.sellQuery);
  return total;
}

/** Map field names to labels for readable output. */
const fieldLabels: Record<string, string> = Object.fromEntries(
  botFields.map((f) => [f.name, f.label]),
);

/** Build a human-readable description of a rule group. */
function describeQuery(group: RuleGroupType): string {
  if (group.rules.length === 0) return 'No rules defined';
  const parts = group.rules.map((rule) => {
    if ('rules' in rule) return `(${describeQuery(rule as RuleGroupType)})`;
    const r = rule as { field: string; operator: string; value: string };
    const label = fieldLabels[r.field] ?? r.field;
    return `${label} ${r.operator} ${r.value}`;
  });
  return parts.join(` ${group.combinator.toUpperCase()} `);
}

/** Default empty query for new rule groups. */
const emptyQuery: RuleGroupType = { combinator: 'and', rules: [] };

/** Shared styles for the query builder card. */
const queryBuilderSx = {
  mb: 3,
  p: 2,
  '& .ruleGroup': {
    borderColor: 'divider',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 1,
    p: 1.5,
    mt: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  '& .ruleGroup .ruleGroup': {
    bgcolor: `${colors.primary.main}06`,
    borderColor: `${colors.primary.main}33`,
  },
  '& .ruleGroup-header, & .rule': {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    px: 1,
    py: 0.5,
  },
  '& .ruleGroup-header .MuiButton-root, & .rule .MuiButton-root': {
    fontSize: '0.8rem',
    padding: '4px 10px',
  },
  '& .rule-remove': {
    padding: '2px',
  },
};

/** Human-readable execution mode labels. */
const executionModeLabels: Record<ExecutionMode, string> = {
  once_and_wait: 'Once & Wait',
  condition_cooldown: 'Condition Cooldown',
};

/** Describe what actions this bot performs. */
function describeActions(bot: ApiBotRecord): string {
  const actions: string[] = [];
  if (bot.buyQuery) actions.push('Buy');
  if (bot.sellQuery) actions.push('Sell');
  return actions.join(' + ');
}

/** Bots management page with list and editor views. */
export default function Bots() {
  const navigate = useNavigate();
  const { request } = useApi();
  const [botList, setBotList] = useState<ApiBotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingBot, setEditingBot] = useState<ApiBotRecord | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor form state
  const [name, setName] = useState('');
  const [pair, setPair] = useState<string>(tradingPairs[0]);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('condition_cooldown');
  const [cooldownMinutes, setCooldownMinutes] = useState<number | ''>('');
  const [buyEnabled, setBuyEnabled] = useState(true);
  const [sellEnabled, setSellEnabled] = useState(false);
  const [buyQuery, setBuyQuery] = useState<RuleGroupType>(emptyQuery);
  const [sellQuery, setSellQuery] = useState<RuleGroupType>(emptyQuery);

  /** Fetch bots from the API. */
  const fetchBots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await request<{ items: ApiBotRecord[] }>('GET', '/trading/bots');
      setBotList(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  /** Open the editor for creating a new bot. */
  const handleCreate = () => {
    setName('');
    setPair(tradingPairs[0]);
    setExecutionMode('condition_cooldown');
    setCooldownMinutes('');
    setBuyEnabled(true);
    setSellEnabled(false);
    setBuyQuery(emptyQuery);
    setSellQuery(emptyQuery);
    setEditingBot({ sub: '', botId: '', name: '', pair: tradingPairs[0], status: 'draft', executionMode: 'condition_cooldown', createdAt: '', updatedAt: '' });
  };

  /** Open the editor for an existing bot. */
  const handleEdit = (bot: ApiBotRecord) => {
    setName(bot.name);
    setPair(bot.pair);
    setExecutionMode(bot.executionMode);
    setCooldownMinutes(bot.cooldownMinutes ?? '');
    setBuyEnabled(!!bot.buyQuery);
    setSellEnabled(!!bot.sellQuery);
    setBuyQuery(bot.buyQuery ?? emptyQuery);
    setSellQuery(bot.sellQuery ?? emptyQuery);
    setEditingBot(bot);
  };

  /** Save the current editor state (create or update). */
  const handleSave = async () => {
    if (!editingBot) return;
    if (!buyEnabled && !sellEnabled) {
      setError('At least one action (Buy or Sell) must be enabled');
      return;
    }
    if (executionMode === 'once_and_wait' && (!buyEnabled || !sellEnabled)) {
      setError('Once and wait mode requires both Buy and Sell rules');
      return;
    }
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = { name, pair, executionMode };
    if (buyEnabled) payload.buyQuery = buyQuery;
    if (sellEnabled) payload.sellQuery = sellQuery;
    // Explicitly clear removed queries on update
    if (!buyEnabled) payload.buyQuery = null;
    if (!sellEnabled) payload.sellQuery = null;
    if (executionMode === 'condition_cooldown' && typeof cooldownMinutes === 'number' && cooldownMinutes > 0) {
      payload.cooldownMinutes = cooldownMinutes;
    } else {
      payload.cooldownMinutes = 0;
    }

    try {
      if (editingBot.botId) {
        await request('PUT', `/trading/bots/${editingBot.botId}`, payload);
      } else {
        // For create, only send present queries
        const createPayload: Record<string, unknown> = { name, pair, executionMode };
        if (buyEnabled) createPayload.buyQuery = buyQuery;
        if (sellEnabled) createPayload.sellQuery = sellQuery;
        if (executionMode === 'condition_cooldown' && typeof cooldownMinutes === 'number' && cooldownMinutes > 0) {
          createPayload.cooldownMinutes = cooldownMinutes;
        }
        await request('POST', '/trading/bots', createPayload);
      }
      setEditingBot(null);
      await fetchBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bot');
    } finally {
      setSaving(false);
    }
  };

  /** Toggle bot status between active and paused. */
  const handleToggleStatus = async (bot: ApiBotRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = bot.status === 'active' ? 'paused' : 'active';
    try {
      await request('PUT', `/trading/bots/${bot.botId}`, { status: newStatus });
      await fetchBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  /** Delete a bot. */
  const handleDelete = async (bot: ApiBotRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await request('DELETE', `/trading/bots/${bot.botId}`);
      await fetchBots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bot');
    }
  };

  /** Discard changes and return to the list. */
  const handleCancel = () => {
    setEditingBot(null);
    setError(null);
  };

  // ─── Editor View ───────────────────────────────────────────────
  if (editingBot) {
    const isNew = !editingBot.botId;
    return (
      <Box>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
          <IconButton onClick={handleCancel}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">{isNew ? 'Create Bot' : 'Edit Bot'}</Typography>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Name & Pair */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Bot Name"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Trading Pair"
              fullWidth
              select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            >
              {tradingPairs.map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        {/* Execution Mode */}
        <TextField
          label="Execution Mode"
          fullWidth
          select
          value={executionMode}
          onChange={(e) => {
            const mode = e.target.value as ExecutionMode;
            setExecutionMode(mode);
            if (mode === 'once_and_wait') {
              setBuyEnabled(true);
              setSellEnabled(true);
            }
          }}
          helperText={
            executionMode === 'once_and_wait'
              ? 'Fires once, then waits for the counter-action before re-triggering. Requires both Buy and Sell rules.'
              : 'Fires when conditions are met, then waits for conditions to clear before re-triggering.'
          }
          sx={{ mb: 3 }}
        >
          <MenuItem value="condition_cooldown">Condition Cooldown</MenuItem>
          <MenuItem value="once_and_wait">Once & Wait</MenuItem>
        </TextField>

        {/* Cooldown Period (condition_cooldown only) */}
        {executionMode === 'condition_cooldown' && (
          <TextField
            label="Cooldown Period (minutes)"
            type="number"
            fullWidth
            value={cooldownMinutes}
            onChange={(e) => {
              const val = e.target.value;
              setCooldownMinutes(val === '' ? '' : Math.max(0, Number(val)));
            }}
            helperText="Minimum time between trades per action. Leave empty or 0 for no time-based cooldown."
            slotProps={{ htmlInput: { min: 0 } }}
            sx={{ mb: 3 }}
          />
        )}

        {/* Buy Action */}
        <Card sx={queryBuilderSx}>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Buy Rules</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={buyEnabled}
                    onChange={(e) => setBuyEnabled(e.target.checked)}
                    disabled={executionMode === 'once_and_wait'}
                    color="success"
                  />
                }
                label="Enabled"
              />
            </Stack>
            {buyEnabled && (
              <>
                <QueryBuilderMaterial>
                  <QueryBuilder
                    fields={botFields}
                    query={buyQuery}
                    onQueryChange={setBuyQuery}
                  />
                </QueryBuilderMaterial>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 2, fontStyle: 'italic' }}
                >
                  When {describeQuery(buyQuery)}, then BUY
                </Typography>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sell Action */}
        <Card sx={queryBuilderSx}>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Sell Rules</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={sellEnabled}
                    onChange={(e) => setSellEnabled(e.target.checked)}
                    disabled={executionMode === 'once_and_wait'}
                    color="error"
                  />
                }
                label="Enabled"
              />
            </Stack>
            {sellEnabled && (
              <>
                <QueryBuilderMaterial>
                  <QueryBuilder
                    fields={botFields}
                    query={sellQuery}
                    onQueryChange={setSellQuery}
                  />
                </QueryBuilderMaterial>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 2, fontStyle: 'italic' }}
                >
                  When {describeQuery(sellQuery)}, then SELL
                </Typography>
              </>
            )}
          </CardContent>
        </Card>

        {/* Save / Cancel */}
        <Stack direction="row" spacing={2}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!name.trim() || (!buyEnabled && !sellEnabled) || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outlined" onClick={handleCancel}>
            Cancel
          </Button>
        </Stack>
      </Box>
    );
  }

  // ─── List View ─────────────────────────────────────────────────
  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 4 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            Bots
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage your automated trading strategies.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
          Create Bot
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={2}>
          {botList.map((bot) => (
            <Grid key={bot.botId} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card>
                <CardActionArea onClick={() => handleEdit(bot)}>
                  <CardContent>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                      <Typography variant="subtitle1" fontWeight={600} noWrap>
                        {bot.name}
                      </Typography>
                      <Chip
                        label={bot.status}
                        size="small"
                        color={statusColor[bot.status]}
                        variant="outlined"
                      />
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/bots/${bot.pair.replace('/', '-')}`);
                        }}
                      >
                        {bot.pair}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {describeActions(bot)} · {executionModeLabels[bot.executionMode]}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {countBotRules(bot)} rule{countBotRules(bot) !== 1 ? 's' : ''}
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/bots/view/${bot.botId}`);
                          }}
                          title="View Performance"
                        >
                          <BarChartIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => handleToggleStatus(bot, e)}
                          title={bot.status === 'active' ? 'Pause' : 'Activate'}
                        >
                          {bot.status === 'active' ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(e) => handleDelete(bot, e)}
                          title="Delete"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
          {botList.length === 0 && !loading && (
            <Grid size={12}>
              <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
                No bots yet. Click &quot;Create Bot&quot; to get started.
              </Typography>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
