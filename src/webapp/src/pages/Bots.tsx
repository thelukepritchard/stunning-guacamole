import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { QueryBuilder, type RuleGroupType } from 'react-querybuilder';
import { QueryBuilderMaterial } from '@react-querybuilder/material';
import { botFields } from '../data/botFields';
import { bots as initialBots, tradingPairs, type Bot, type BotAction, type BotStatus } from '../data/mockData';

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

/** Default empty query for new bots. */
const emptyQuery: RuleGroupType = { combinator: 'and', rules: [] };

/** Bots management page with list and editor views. */
export default function Bots() {
  const [botList, setBotList] = useState<Bot[]>(initialBots);
  const [editingBot, setEditingBot] = useState<Bot | null>(null);

  // Editor form state
  const [name, setName] = useState('');
  const [pair, setPair] = useState<string>(tradingPairs[0]);
  const [action, setAction] = useState<BotAction>('buy');
  const [query, setQuery] = useState<RuleGroupType>(emptyQuery);

  /** Open the editor for creating a new bot. */
  const handleCreate = () => {
    setName('');
    setPair(tradingPairs[0]);
    setAction('buy');
    setQuery(emptyQuery);
    setEditingBot({ id: '', name: '', pair: tradingPairs[0], action: 'buy', status: 'draft', createdAt: '', query: emptyQuery });
  };

  /** Open the editor for an existing bot. */
  const handleEdit = (bot: Bot) => {
    setName(bot.name);
    setPair(bot.pair);
    setAction(bot.action);
    setQuery(bot.query);
    setEditingBot(bot);
  };

  /** Save the current editor state back to the list. */
  const handleSave = () => {
    if (!editingBot) return;

    if (editingBot.id) {
      // Update existing bot
      setBotList((prev) =>
        prev.map((b) => (b.id === editingBot.id ? { ...b, name, pair, action, query } : b)),
      );
    } else {
      // Create new bot
      const newBot: Bot = {
        id: `bot-${Date.now()}`,
        name,
        pair,
        action,
        status: 'draft',
        createdAt: new Date().toISOString().split('T')[0]!,
        query,
      };
      setBotList((prev) => [...prev, newBot]);
    }
    setEditingBot(null);
  };

  /** Discard changes and return to the list. */
  const handleCancel = () => {
    setEditingBot(null);
  };

  // ─── Editor View ───────────────────────────────────────────────
  if (editingBot) {
    const isNew = !editingBot.id;
    return (
      <Box>
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
          <IconButton onClick={handleCancel}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">{isNew ? 'Create Bot' : 'Edit Bot'}</Typography>
        </Stack>

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

        {/* Query Builder */}
        <Card
          sx={{
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
              bgcolor: 'rgba(25, 118, 210, 0.04)',
              borderColor: 'rgba(25, 118, 210, 0.2)',
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
          }}
        >
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Trading Rules
            </Typography>
            <QueryBuilderMaterial>
              <QueryBuilder
                fields={botFields}
                query={query}
                onQueryChange={setQuery}
              />
            </QueryBuilderMaterial>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 2, fontStyle: 'italic' }}
            >
              When {describeQuery(query)}, then {action.toUpperCase()}
            </Typography>
          </CardContent>
        </Card>

        {/* Action */}
        <TextField
          label="Action"
          fullWidth
          select
          value={action}
          onChange={(e) => setAction(e.target.value as BotAction)}
          sx={{ mb: 3 }}
        >
          <MenuItem value="buy">Buy</MenuItem>
          <MenuItem value="sell">Sell</MenuItem>
        </TextField>

        {/* Save / Cancel */}
        <Stack direction="row" spacing={2}>
          <Button variant="contained" onClick={handleSave} disabled={!name.trim()}>
            Save
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
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5">Bots</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
          Create Bot
        </Button>
      </Stack>

      {/* Bot Cards */}
      <Grid container spacing={2}>
        {botList.map((bot) => (
          <Grid key={bot.id} size={{ xs: 12, sm: 6, md: 4 }}>
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
                  <Typography variant="body2" color="text.secondary">
                    {bot.pair}
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {countRules(bot.query)} rule{countRules(bot.query) !== 1 ? 's' : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {bot.createdAt}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
