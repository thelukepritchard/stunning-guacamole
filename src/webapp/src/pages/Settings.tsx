import { useEffect, useState } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * Settings page displaying user account information.
 */
export default function Settings() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    fetchUserAttributes()
      .then((attrs) => {
        setEmail(attrs.email ?? '');
        const fullName = [attrs.given_name, attrs.family_name].filter(Boolean).join(' ');
        setName(fullName || attrs.name || '');
      })
      .catch(() => {});
  }, []);

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage your account and preferences.
        </Typography>
      </Box>

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
      </Stack>
    </Box>
  );
}
