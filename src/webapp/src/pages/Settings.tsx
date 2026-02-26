import { useEffect, useState, useCallback } from 'react';
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
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useApi } from '../hooks/useApi';

/** Supported exchange identifiers. */
type ExchangeId = 'demo' | 'swyftx' | 'coinspot' | 'coinjar' | 'kraken_pro' | 'binance';

/** Exchange option returned by the API (only real exchanges, not demo). */
interface ExchangeOption {
  exchangeId: ExchangeId;
  name: string;
  description: string;
  baseCurrencies: string[];
  phase: 1 | 2;
}

/** Trading settings response from the API (no secrets). */
interface TradingSettings {
  exchange: ExchangeId;
  baseCurrency: string;
  maskedApiKey?: string;
  updatedAt: string;
}

/**
 * Settings page displaying user account information and trading exchange configuration.
 *
 * Users select a single exchange and base currency for their account. All bots
 * operate against this exchange. Changing the exchange disables all active bots.
 */
export default function Settings() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Settings state
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [exchangeOptions, setExchangeOptions] = useState<ExchangeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showExchangeWarning, setShowExchangeWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formExchange, setFormExchange] = useState<ExchangeId | ''>('');
  const [formBaseCurrency, setFormBaseCurrency] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formApiSecret, setFormApiSecret] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);

  // Delete account state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const { request } = useApi();
  const navigate = useNavigate();

  useEffect(() => {
    fetchUserAttributes()
      .then((attrs) => {
        setEmail(attrs.email ?? '');
        const fullName = [attrs.given_name, attrs.family_name].filter(Boolean).join(' ');
        setName(fullName || attrs.name || '');
      })
      .catch(() => {});
  }, []);

  /** Fetches the user's trading settings and exchange options from the API. */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, optionsRes] = await Promise.allSettled([
        request<TradingSettings>('GET', '/settings'),
        request<{ exchanges: ExchangeOption[] }>('GET', '/settings/exchange-options'),
      ]);

      if (optionsRes.status === 'fulfilled') {
        setExchangeOptions(optionsRes.value.exchanges);
      }

      if (settingsRes.status === 'fulfilled') {
        setSettings(settingsRes.value);
      } else {
        // 404 means not configured yet — that's OK
        setSettings(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Whether the user has a real (non-demo) exchange configured. */
  const hasRealExchange = settings !== null && settings.exchange !== 'demo';

  /** Opens the configure exchange dialog. */
  const handleOpenDialog = () => {
    if (hasRealExchange) {
      setFormExchange(settings!.exchange);
      setFormBaseCurrency(settings!.baseCurrency);
    } else {
      setFormExchange('');
      setFormBaseCurrency('');
    }
    setFormApiKey('');
    setFormApiSecret('');
    setShowApiKey(false);
    setShowApiSecret(false);
    setShowExchangeWarning(false);
    setDialogOpen(true);
  };

  /** Handles exchange selection — shows warning if changing from an existing real exchange. */
  const handleExchangeChange = (newExchange: ExchangeId) => {
    setFormExchange(newExchange);
    setFormBaseCurrency('');
    if (hasRealExchange && settings!.exchange !== newExchange) {
      setShowExchangeWarning(true);
    } else {
      setShowExchangeWarning(false);
    }
  };

  /** Available base currencies for the currently selected exchange. */
  const availableBaseCurrencies =
    formExchange
      ? exchangeOptions.find((e) => e.exchangeId === formExchange)?.baseCurrencies ?? []
      : [];

  /** Handles saving the trading settings. */
  const handleSubmit = async () => {
    if (!formExchange || !formBaseCurrency || !formApiKey || !formApiSecret) {
      setError('All fields are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await request('PUT', '/settings', {
        exchange: formExchange,
        baseCurrency: formBaseCurrency,
        apiKey: formApiKey,
        apiSecret: formApiSecret,
      });
      const exchangeName = exchangeOptions.find((e) => e.exchangeId === formExchange)?.name ?? formExchange;
      setSuccess(`Exchange configured: ${exchangeName} (${formBaseCurrency})`);
      setDialogOpen(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSubmitting(false);
    }
  };

  /** Gets the display name for an exchange ID. */
  const getExchangeName = (id: ExchangeId) =>
    exchangeOptions.find((e) => e.exchangeId === id)?.name ?? id;

  /** Handles account deletion after confirmation. */
  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError(null);
    try {
      await request('DELETE', '/account');
      await signOut();
      navigate('/sign-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleteConfirmText('');
      setDeleteDialogOpen(false);
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage your account and trading configuration.
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

        {/* Exchange Configuration */}
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6">Exchange</Typography>
                <Typography variant="body2" color="text.secondary">
                  Configure the exchange your bots will trade on.
                </Typography>
              </Box>
              <Button
                variant={hasRealExchange ? 'outlined' : 'contained'}
                size="small"
                startIcon={hasRealExchange ? <EditIcon /> : undefined}
                onClick={handleOpenDialog}
              >
                {hasRealExchange ? 'Change' : 'Configure Exchange'}
              </Button>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : hasRealExchange ? (
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2">Exchange</Typography>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {getExchangeName(settings!.exchange)}
                    </Typography>
                    <Chip label={settings!.baseCurrency} size="small" variant="outlined" />
                  </Stack>
                </Box>
                <Box>
                  <Typography variant="subtitle2">API Key</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {settings!.maskedApiKey}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Last updated {new Date(settings!.updatedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              </Stack>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Chip label="Demo Mode" size="small" color="info" variant="outlined" sx={{ mb: 1.5 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  You are currently in demo mode — trades are simulated.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Configure a real exchange to start placing live trades.
                </Typography>
              </Box>
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
              exchange settings, and demo data. This action cannot be undone.
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
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
              disabled={deleting}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteAccount}
            disabled={deleting || deleteConfirmText !== 'delete'}
          >
            {deleting ? <CircularProgress size={20} /> : 'Delete My Account'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Configure Exchange Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {hasRealExchange ? 'Update Exchange Configuration' : 'Configure Exchange'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {showExchangeWarning && (
              <Alert severity="warning" icon={<WarningAmberIcon />}>
                Changing your exchange will <strong>disable all of your active bots</strong>.
                You will need to re-enable them manually after switching.
              </Alert>
            )}

            <TextField
              select
              label="Exchange"
              value={formExchange}
              onChange={(e) => handleExchangeChange(e.target.value as ExchangeId)}
              fullWidth
              size="small"
            >
              {exchangeOptions.map((opt) => (
                <MenuItem key={opt.exchangeId} value={opt.exchangeId} disabled={opt.phase > 1}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2">{opt.name}</Typography>
                    {opt.phase > 1 && (
                      <Chip label="Coming Soon" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                    )}
                  </Stack>
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
              helperText="Your API credentials are encrypted at rest and never exposed."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || !formExchange || !formBaseCurrency || !formApiKey || !formApiSecret}
          >
            {submitting ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
