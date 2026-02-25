import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router';
import { gradients } from '@shared/styles/tokens';

/** 404 page displayed when a route does not exist. */
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box sx={{ pt: { xs: 10, md: 14 }, pb: { xs: 8, md: 10 } }}>
      <Container maxWidth="sm" sx={{ textAlign: 'center' }}>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: '5rem', md: '8rem' },
            fontWeight: 700,
            mb: 1,
            background: gradients.primary,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          404
        </Typography>
        <Typography variant="h4" sx={{ mb: 1 }}>
          Page not found
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
          The page you're looking for doesn't exist or has been moved.
        </Typography>
        <Button variant="contained" size="large" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </Container>
    </Box>
  );
}
