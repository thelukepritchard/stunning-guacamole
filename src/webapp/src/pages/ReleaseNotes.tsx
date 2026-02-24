import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** A single release entry. */
interface Release {
  version: string;
  date: string;
  tag: 'New' | 'Improvement' | 'Fix';
  items: string[];
}

const RELEASES: Release[] = [
  {
    version: '0.1.0',
    date: '24 Feb 2026',
    tag: 'New',
    items: [
      'Initial release of the No-code Bot Trading platform.',
      'Dashboard with portfolio performance and trading volume charts.',
      'Portfolio and orderbook views.',
      'Bot management page.',
    ],
  },
];

/** Maps a release tag to a MUI chip colour. */
const TAG_COLOUR: Record<Release['tag'], 'primary' | 'success' | 'warning'> = {
  New: 'primary',
  Improvement: 'success',
  Fix: 'warning',
};

/**
 * Release notes page showing a chronological list of product updates.
 */
export default function ReleaseNotes() {
  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Release Notes
        </Typography>
        <Typography variant="body2" color="text.secondary">
          What&apos;s new in the platform.
        </Typography>
      </Box>

      <Stack spacing={3} sx={{ maxWidth: 700 }}>
        {RELEASES.map((release) => (
          <Card key={release.version}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                <Typography variant="h6">v{release.version}</Typography>
                <Chip label={release.tag} color={TAG_COLOUR[release.tag]} size="small" variant="outlined" />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {release.date}
              </Typography>
              <Divider sx={{ my: 2 }} />
              <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                {release.items.map((item) => (
                  <Typography key={item} component="li" variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
