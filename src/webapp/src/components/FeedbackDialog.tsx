import { useState, type FormEvent } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** Props for {@link FeedbackDialog}. */
interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal dialog allowing users to submit feedback or report issues.
 */
export default function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Handles feedback form submission. */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const category = formData.get('category') as string;
    const message = formData.get('message') as string;

    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      const res = await fetch(`${import.meta.env.VITE_API_URL}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ?? '',
        },
        body: JSON.stringify({ category, message }),
      });

      if (!res.ok) throw new Error('Failed to submit feedback');

      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Resets state when closing. */
  const handleClose = () => {
    setSubmitted(false);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Feedback</DialogTitle>
      <DialogContent>
        {submitted ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            Thanks for your feedback! We appreciate you taking the time to help us improve.
          </Alert>
        ) : (
          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Let us know how we can improve your experience.
            </Typography>

            {error && <Alert severity="error">{error}</Alert>}

            <FormControl>
              <FormLabel htmlFor="category">Category</FormLabel>
              <TextField
                id="category"
                name="category"
                select
                defaultValue="general"
                fullWidth
                size="small"
              >
                <MenuItem value="general">General</MenuItem>
                <MenuItem value="bug">Bug report</MenuItem>
                <MenuItem value="feature">Feature request</MenuItem>
              </TextField>
            </FormControl>

            <FormControl>
              <FormLabel htmlFor="message">Message</FormLabel>
              <TextField
                id="message"
                name="message"
                multiline
                minRows={4}
                placeholder="Tell us what's on your mind..."
                fullWidth
                size="small"
                required
              />
            </FormControl>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={handleClose} variant="text">
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit feedback'}
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
