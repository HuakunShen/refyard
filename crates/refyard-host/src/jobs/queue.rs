//! Bounded work, one writer per repository.
//!
//! Three limits, each with a reason:
//!
//! - **one writer per write key**, enforced *inside this service*. The design is explicit
//!   that this is not a lock on the repository: an IDE, a terminal or another agent can
//!   still write at the same time. What the queue guarantees is that this service does not
//!   race *itself*, and it never claims otherwise — no Git lock file is deleted, no
//!   operation is forced.
//! - **up to two readers per repository and four Git processes in total.** A read and a
//!   write can run at once (Git tolerates that), but a repository cannot have three
//!   concurrent reads against one object store, and this machine cannot have five Git
//!   processes from this service.
//! - **a bounded queue per actor** (32 by default). A client that submits faster than work
//!   completes is told the queue is full rather than growing the process until it dies.
//!
//! Cancellation only applies to work that has not started: a running mutation is never
//! relabelled `cancelled`, because the process may already have changed the repository and
//! pretending otherwise would hide that.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// The limits the published contract names.
pub const DEFAULT_QUEUED_PER_ACTOR: usize = 32;
pub const DEFAULT_GIT_PROCESSES: usize = 4;
pub const DEFAULT_READERS_PER_REPOSITORY: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueMode {
    Read,
    Write,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueLimits {
    pub max_queued_per_actor: usize,
    pub max_global_git_processes: usize,
    pub max_readers_per_repository: usize,
}

impl Default for QueueLimits {
    fn default() -> Self {
        Self {
            max_queued_per_actor: DEFAULT_QUEUED_PER_ACTOR,
            max_global_git_processes: DEFAULT_GIT_PROCESSES,
            max_readers_per_repository: DEFAULT_READERS_PER_REPOSITORY,
        }
    }
}

/// One queued piece of work.
#[derive(Debug, Clone)]
pub struct QueueTicket<J> {
    pub id: String,
    pub actor: String,
    /// The key the work serialises under: a repository's common Git directory on one
    /// target, or the approved root a repository is being created in.
    pub repository_id: String,
    pub mode: QueueMode,
    /// Position at enqueue time, for a UI that wants to show "2 ahead of you".
    pub position_at_enqueue: usize,
    pub job: J,
}

/// Why work was not queued.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueRefusal {
    /// This actor already has the maximum number of operations waiting.
    QueueFull,
    /// The same operation id is already queued.
    AlreadyQueued,
    /// The host is closing and will not accept new work.
    Closed,
}

/// The queue. Generic over the work it carries, because the limits are about Git processes
/// and writers rather than about what the work happens to be.
#[derive(Debug)]
pub struct Queue<J> {
    inner: Mutex<QueueState<J>>,
    limits: QueueLimits,
}

#[derive(Debug)]
struct QueueState<J> {
    pending: Vec<QueueTicket<J>>,
    running: HashMap<String, QueueTicket<J>>,
    writers: HashSet<String>,
    readers: HashMap<String, usize>,
    closed: bool,
}

impl<J: Clone> Default for Queue<J> {
    fn default() -> Self {
        Self::new(QueueLimits::default())
    }
}

impl<J: Clone> Queue<J> {
    pub fn new(limits: QueueLimits) -> Self {
        Self {
            inner: Mutex::new(QueueState {
                pending: Vec::new(),
                running: HashMap::new(),
                writers: HashSet::new(),
                readers: HashMap::new(),
                closed: false,
            }),
            limits,
        }
    }

    /// Adds work, bounded per actor and per operation id.
    pub fn enqueue(
        &self,
        id: impl Into<String>,
        actor: &str,
        repository_id: &str,
        mode: QueueMode,
        job: J,
    ) -> Result<QueueTicket<J>, EnqueueRefusal> {
        let id = id.into();
        let mut state = self.inner.lock().expect("queue lock");
        if state.closed {
            return Err(EnqueueRefusal::Closed);
        }
        let depth = state
            .pending
            .iter()
            .filter(|ticket| ticket.actor == actor)
            .count();
        if depth >= self.limits.max_queued_per_actor {
            return Err(EnqueueRefusal::QueueFull);
        }
        if state.pending.iter().any(|ticket| ticket.id == id) {
            return Err(EnqueueRefusal::AlreadyQueued);
        }
        let ticket = QueueTicket {
            id,
            actor: actor.to_string(),
            repository_id: repository_id.to_string(),
            mode,
            position_at_enqueue: state.pending.len(),
            job,
        };
        state.pending.push(ticket.clone());
        Ok(ticket)
    }

    /// Removes work that has not started. Returns false once it is running.
    pub fn cancel(&self, id: &str) -> bool {
        let mut state = self.inner.lock().expect("queue lock");
        let Some(index) = state.pending.iter().position(|ticket| ticket.id == id) else {
            return false;
        };
        state.pending.remove(index);
        true
    }

    /// Removes every ticket that has not started, for lifecycle shutdown.
    pub fn close(&self) -> Vec<QueueTicket<J>> {
        let mut state = self.inner.lock().expect("queue lock");
        state.closed = true;
        std::mem::take(&mut state.pending)
    }

    /// Takes every ticket that may start now, recording each as running.
    ///
    /// One pass in queue order: a job that cannot start does not block the one behind it,
    /// so a busy repository cannot stall every other repository. The caller must call
    /// [`Self::release`] exactly once per ticket, whatever the outcome — that is what makes
    /// the limits self-healing after a failure rather than dependent on a happy path.
    pub fn take_startable(&self) -> Vec<QueueTicket<J>> {
        let mut state = self.inner.lock().expect("queue lock");
        if state.closed {
            return Vec::new();
        }
        let mut started = Vec::new();
        let mut index = 0;
        while index < state.pending.len() {
            let allowed = {
                let ticket = &state.pending[index];
                can_start(&state, ticket, &self.limits)
            };
            if !allowed {
                index += 1;
                continue;
            }
            let ticket = state.pending.remove(index);
            match ticket.mode {
                QueueMode::Write => {
                    state.writers.insert(ticket.repository_id.clone());
                }
                QueueMode::Read => {
                    *state
                        .readers
                        .entry(ticket.repository_id.clone())
                        .or_insert(0) += 1;
                }
            }
            state.running.insert(ticket.id.clone(), ticket.clone());
            started.push(ticket);
        }
        started
    }

    /// Marks one started ticket as finished.
    pub fn release(&self, id: &str) {
        let mut state = self.inner.lock().expect("queue lock");
        let Some(ticket) = state.running.remove(id) else {
            return;
        };
        match ticket.mode {
            QueueMode::Write => {
                state.writers.remove(&ticket.repository_id);
            }
            QueueMode::Read => {
                let current = state
                    .readers
                    .get(&ticket.repository_id)
                    .copied()
                    .unwrap_or(0);
                if current <= 1 {
                    state.readers.remove(&ticket.repository_id);
                } else {
                    state
                        .readers
                        .insert(ticket.repository_id.clone(), current - 1);
                }
            }
        }
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.inner
            .lock()
            .expect("queue lock")
            .running
            .contains_key(id)
    }

    pub fn pending_count(&self) -> usize {
        self.inner.lock().expect("queue lock").pending.len()
    }

    pub fn running_count(&self) -> usize {
        self.inner.lock().expect("queue lock").running.len()
    }

    /// How much work one actor has waiting.
    pub fn depth_for(&self, actor: &str) -> usize {
        self.inner
            .lock()
            .expect("queue lock")
            .pending
            .iter()
            .filter(|ticket| ticket.actor == actor)
            .count()
    }
}

fn can_start<J>(state: &QueueState<J>, ticket: &QueueTicket<J>, limits: &QueueLimits) -> bool {
    if state.running.len() >= limits.max_global_git_processes {
        return false;
    }
    if ticket.mode == QueueMode::Write {
        return !state.writers.contains(&ticket.repository_id);
    }
    if state.writers.contains(&ticket.repository_id) {
        // A read during a write would race the index; the design allows reads alongside
        // reads, not alongside a mutation of the same repository.
        return false;
    }
    state
        .readers
        .get(&ticket.repository_id)
        .copied()
        .unwrap_or(0)
        < limits.max_readers_per_repository
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Queues one write and answers with the ids that may start now.
    fn startable_after(queue: &Queue<u32>) -> Vec<String> {
        queue
            .take_startable()
            .into_iter()
            .map(|ticket| ticket.id)
            .collect()
    }

    #[test]
    fn one_writer_per_key_runs_until_its_slot_is_released() {
        // Prevents: two mutations of one repository running at once, which is how a stage
        // and a commit interleave into an index nobody can explain.
        let queue = Queue::new(QueueLimits::default());
        for (id, key) in [("op_1", "repo/a"), ("op_2", "repo/a"), ("op_3", "repo/b")] {
            queue
                .enqueue(id, "owner", key, QueueMode::Write, 1)
                .expect("queued");
        }
        assert_eq!(
            startable_after(&queue),
            vec!["op_1".to_string(), "op_3".to_string()],
            "a different repository is not blocked by the first one's writer"
        );
        assert_eq!(queue.running_count(), 2);
        assert_eq!(queue.pending_count(), 1);

        queue.release("op_1");
        assert_eq!(
            startable_after(&queue),
            vec!["op_2".to_string()],
            "the waiting writer starts as soon as the key is free"
        );
        queue.release("op_2");
        queue.release("op_3");
        assert_eq!(queue.running_count(), 0);
        assert_eq!(queue.pending_count(), 0);
    }

    #[test]
    fn a_reader_does_not_run_alongside_a_writer_of_the_same_repository() {
        // Prevents: a status read racing an index write, which would let the UI show a
        // half-written index as a settled one.
        let queue = Queue::new(QueueLimits::default());
        queue
            .enqueue("write", "owner", "repo/a", QueueMode::Write, 1)
            .expect("queued");
        queue
            .enqueue("read", "owner", "repo/a", QueueMode::Read, 2)
            .expect("queued");
        queue
            .enqueue("other-read", "owner", "repo/b", QueueMode::Read, 3)
            .expect("queued");
        assert_eq!(
            startable_after(&queue),
            vec!["write".to_string(), "other-read".to_string()]
        );
        queue.release("write");
        assert_eq!(startable_after(&queue), vec!["read".to_string()]);
    }

    #[test]
    fn a_released_slot_is_reusable_and_a_cancelled_ticket_never_starts() {
        // Prevents: a repository that looks permanently busy after one failure, and a
        // queued operation that runs after its cancellation was reported.
        let queue = Queue::new(QueueLimits::default());
        queue
            .enqueue("op_1", "owner", "repo/a", QueueMode::Write, 1)
            .expect("queued");
        assert!(queue.cancel("op_1"));
        assert!(
            startable_after(&queue).is_empty(),
            "a cancelled ticket is gone"
        );
        assert!(!queue.cancel("op_1"), "cancelling twice is not an error");

        queue
            .enqueue("op_2", "owner", "repo/a", QueueMode::Write, 2)
            .expect("queued");
        assert_eq!(startable_after(&queue), vec!["op_2".to_string()]);
        queue.release("op_2");
        queue
            .enqueue("op_3", "owner", "repo/a", QueueMode::Write, 3)
            .expect("queued");
        assert_eq!(
            startable_after(&queue),
            vec!["op_3".to_string()],
            "the key is free again after a release"
        );
    }

    #[test]
    fn the_queue_is_bounded_per_actor() {
        // Prevents: a client that submits faster than work completes growing the process
        // until it dies; it is told the queue is full instead.
        let queue = Queue::new(QueueLimits {
            max_queued_per_actor: 2,
            ..QueueLimits::default()
        });
        assert!(queue
            .enqueue("op_1", "owner", "repo/a", QueueMode::Write, 1)
            .is_ok());
        assert!(queue
            .enqueue("op_2", "owner", "repo/b", QueueMode::Write, 2)
            .is_ok());
        assert!(matches!(
            queue.enqueue("op_3", "owner", "repo/c", QueueMode::Write, 3),
            Err(EnqueueRefusal::QueueFull)
        ));
        // Another actor has its own bound.
        assert!(queue
            .enqueue("op_4", "other", "repo/c", QueueMode::Write, 4)
            .is_ok());
    }
}
