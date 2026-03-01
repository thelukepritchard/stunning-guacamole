import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchUserAttributes, signOut } from 'aws-amplify/auth';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useApi } from '../hooks/useApi';
import { useExchange } from '../contexts/ExchangeContext';

/** Supported exchange identifiers. */
type ExchangeId = 'demo' | 'swyftx' | 'coinspot' | 'coinjar' | 'kraken_pro' | 'binance';

/** Phase 1 exchanges available for connection. */
const PHASE_1_EXCHANGES: { id: ExchangeId; name: string }[] = [
  { id: 'swyftx', name: 'Swyftx' },
  { id: 'coinspot', name: 'CoinSpot' },
];

/** Base currencies per exchange. */
const EXCHANGE_CURRENCIES: Record<string, string[]> = {
  swyftx: ['AUD', 'USD'],
  coinspot: ['AUD'],
};

/** Human-readable exchange display names. */
const EXCHANGE_NAMES: Record<string, string> = {
  demo: 'Demo Exchange',
  swyftx: 'Swyftx',
  coinspot: 'CoinSpot',
  coinjar: 'CoinJar',
  kraken_pro: 'Kraken Pro',
  binance: 'Binance',
};

/**
 * Settings page displaying user profile, exchange connection management,
 * and account deletion.
 *
 * Users can add multiple exchange connections (each validated against the
 * exchange), view existing connections with masked API keys, and delete
 * connections. The active exchange is managed via the sidebar dropdown.
 */
export default function Settings() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Alerts
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add connection dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formExchange, setFormExchange] = useState<ExchangeId | ''>('');
  const [formBaseCurrency, setFormBaseCurrency] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formApiSecret, setFormApiSecret] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);

  // Delete connection dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Delete account state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const { request } = useApi();
  const navigate = useNavigate();
  const { connections, loading, refreshConnections } = useExchange();

  useEffect(() => {
    fetchUserAttributes()
      .then((attrs) => {
        setEmail(attrs.email ?? '');
        const fullName = [attrs.given_name, attrs.family_name].filter(Boolean).join(' ');
        setName(fullName || attrs.name || '');
      })
      .catch(() => {});
  }, []);

  /** Opens the add connection dialog with reset form state. */
  const handleOpenAddDialog = () => {
    setFormExchange('');
    setFormBaseCurrency('');
    setFormApiKey('');
    setFormApiSecret('');
    setShowApiKey(false);
    setShowApiSecret(false);
    setAddDialogOpen(true);
  };

  /** Available base currencies for the selected exchange. */
  const availableBaseCurrencies = formExchange ? (EXCHANGE_CURRENCIES[formExchange] ?? []) : [];

  /** Handles creating a new exchange connection. */
  const handleAddConnection = async () => {
    if (!formExchange || !formBaseCurrency || !formApiKey || !formApiSecret) {
      setError('All fields are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await request('POST', '/exchange/connections', {
        exchangeId: formExchange,
        baseCurrency: formBaseCurrency,
        apiKey: formApiKey,
        apiSecret: formApiSecret,
      });
      const exchangeName = EXCHANGE_NAMES[formExchange] ?? formExchange;
      setSuccess(`Connected to ${exchangeName} (${formBaseCurrency})`);
      setAddDialogOpen(false);
      await refreshConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add connection');
    } finally {
      setSubmitting(false);
    }
  };

  /** Handles deleting an exchange connection. */
  const handleDeleteConnection = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await request('DELETE', `/exchange/connections/${deleteTarget}`);
      setSuccess(`${EXCHANGE_NAMES[deleteTarget] ?? deleteTarget} disconnected`);
      setDeleteTarget(null);
      await refreshConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete connection');
    } finally {
      setDeleting(false);
    }
  };

  /** Handles account deletion after confirmation. */
  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    setError(null);
    try {
      await request('DELETE', '/account');
      await signOut();
      navigate('/sign-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleteConfirmText('');
      setDeleteDialogOpen(false);
      setDeletingAccount(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage your account and exchange connections.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Profile */}
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Profile
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2">Name</Typography>
                <Typography variant="body2" color="text.secondary">
                  {name || '\u2014'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2">Email</Typography>
                <Typography variant="body2" color="text.secondary">
                  {email || '\u2014'}
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Exchange Connections */}
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6">Exchange Connections</Typography>
                <Typography variant="body2" color="text.secondary">
                  Connect your exchange accounts to trade with real money.
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleOpenAddDialog}
              >
                Add Connection
              </Button>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : connections.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  No exchange connections configured.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Add a connection to start trading on a real exchange.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {connections.map((conn) => (
                  <Card key={conn.exchangeId} variant="outlined">
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Box>
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                            <Typography variant="subtitle1" fontWeight={600}>
                              {EXCHANGE_NAMES[conn.exchangeId] ?? conn.exchangeId}
                            </Typography>
                            <Chip label={conn.baseCurrency} size="small" variant="outlined" />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                            {conn.maskedApiKey}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Connected {new Date(conn.createdAt).toLocaleDateString()}
                          </Typography>
                        </Box>
                        <IconButton
                          color="error"
                          size="small"
                          onClick={() => setDeleteTarget(conn.exchangeId)}
                          title="Delete connection"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* Delete Account */}
        <Card sx={{ borderColor: 'error.main', borderWidth: 1, borderStyle: 'solid' }}>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" color="error">Danger Zone</Typography>
                <Typography variant="body2" color="text.secondary">
                  Permanently delete your account and all associated data.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={() => { setDeleteDialogOpen(true); setDeleteConfirmText(''); }}
              >
                Delete Account
              </Button>
            </Stack>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary">
              This will permanently remove your profile, all bots, trades, backtests,
              exchange connections, and demo data. This action cannot be undone.
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Add Connection Dialog */}
      <Dialog open={addDialogOpen} onClose={() => !submitting && setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Exchange Connection</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              select
              label="Exchange"
              value={formExchange}
              onChange={(e) => {
                setFormExchange(e.target.value as ExchangeId);
                setFormBaseCurrency('');
              }}
              fullWidth
              size="small"
            >
              {PHASE_1_EXCHANGES.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Base Currency"
              value={formBaseCurrency}
              onChange={(e) => setFormBaseCurrency(e.target.value)}
              fullWidth
              size="small"
              disabled={!formExchange}
              helperText="Used for position sizing and balance calculations."
            >
              {availableBaseCurrencies.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="API Key"
              placeholder="Enter your API key"
              value={formApiKey}
              onChange={(e) => setFormApiKey(e.target.value)}
              fullWidth
              size="small"
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowApiKey(!showApiKey)}
                        edge="end"
                      >
                        {showApiKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <TextField
              label="API Secret"
              placeholder="Enter your API secret"
              value={formApiSecret}
              onChange={(e) => setFormApiSecret(e.target.value)}
              fullWidth
              size="small"
              type={showApiSecret ? 'text' : 'password'}
              autoComplete="off"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowApiSecret(!showApiSecret)}
                        edge="end"
                      >
                        {showApiSecret ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              helperText="Your API credentials are validated against the exchange, then encrypted at rest."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddDialogOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddConnection}
            disabled={submitting || !formExchange || !formBaseCurrency || !formApiKey || !formApiSecret}
          >
            {submitting ? <CircularProgress size={20} /> : 'Connect'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Connection Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Connection</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to disconnect <strong>{EXCHANGE_NAMES[deleteTarget ?? ''] ?? deleteTarget}</strong>?
            If this is your active exchange, you will be switched back to the demo exchange.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteConnection}
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deletingAccount && setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle color="error">Delete Account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="error" icon={<WarningAmberIcon />}>
              This action is <strong>permanent and irreversible</strong>. All of your data
              will be deleted immediately.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Type <strong>delete</strong> below to confirm.
            </Typography>
            <TextField
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              fullWidth
              size="small"
              autoComplete="off"
              disabled={deletingAccount}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deletingAccount}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteAccount}
            disabled={deletingAccount || deleteConfirmText !== 'delete'}
          >
            {deletingAccount ? <CircularProgress size={20} /> : 'Delete My Account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
