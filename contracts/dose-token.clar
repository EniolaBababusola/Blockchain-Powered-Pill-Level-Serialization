;; PillTrack: Dose Token Contract
;; SIP-010 Compliant NFT for Individual Medication Doses
;; Implements tokenization of unique doses with metadata for serialization, status tracking, and expiration.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)
(impl-trait .sip-010-trait.sip-010-trait)

;; Error Constants
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INVALID-TOKEN-ID (err u402))
(define-constant ERR-INVALID-METADATA (err u403))
(define-constant ERR-TOKEN-ALREADY-MINTED (err u404))
(define-constant ERR-EXPIRED-TOKEN (err u405))
(define-constant ERR-INVALID-STATUS (err u406))
(define-constant ERR-NOT-OWNER (err u407))
(define-constant ERR-INVALID-EXPIRATION (err u408))
(define-constant ERR-METADATA-EXCEEDS-LIMIT (err u409))

;; Data Maps
;; Token ownership: Maps token-id to owner principal
(define-map tokens {token-id: uint} principal)

;; Token metadata: Stores dose-specific details
(define-map metadata
    {token-id: uint}
    {
        drug-type: (string-ascii 32),
        batch-id: uint,
        serial-number: (buff 16),  ;; Unique serial for serialization
        expiration: uint,  ;; Block height or timestamp for expiry
        status: (string-ascii 16),  ;; e.g., "active", "dispensed", "redeemed", "recalled"
        manufacturer: principal,
        metadata-hash: (buff 32)  ;; SHA256 of full metadata for integrity
    }
)

;; Token approvals: For delegated transfers
(define-map approvals {token-id: uint} principal)

;; Global counters and configs
(define-data-var last-token-id uint u0)
(define-data-var name (string-ascii 34) "PillTrack Dose Token")
(define-data-var symbol (string-ascii 5) "PDT")
(define-data-var admin principal tx-sender)

;; Private helper: Check if caller is admin
(define-private (is-admin (caller principal))
    (is-eq caller (var-get admin))
)

;; Private helper: Check if caller is owner of token
(define-private (is-owner (token-id uint) (caller principal))
    (let ((owner (map-get? tokens {token-id: token-id})))
        (and (is-some owner) (is-eq (unwrap-panic owner) caller))
    )
)

;; Private helper: Validate metadata
(define-private (validate-metadata (meta {
    drug-type: (string-ascii 32),
    batch-id: uint,
    serial-number: (buff 16),
    expiration: uint,
    status: (string-ascii 16),
    manufacturer: principal,
    metadata-hash: (buff 32)
}))
    (and
        (>= (len (get drug-type meta)) u1)
        (<= (len (get drug-type meta)) u32)
        (> (get expiration meta) block-height)  ;; Not expired at mint
        (or
            (is-eq (get status meta) "active")
            (is-eq (get status meta) "dispensed")
        )
        (<= (len (get serial-number meta)) u16)
        (is-eq (get status meta) "active")  ;; Initial status must be active
    )
)

;; SIP-010: Transfer token to new owner, clearing approval
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
    (begin
        (asserts! (is-owner token-id tx-sender) ERR-NOT-OWNER)
        (asserts! (not (is-eq tx-sender recipient)) ERR-INVALID-TOKEN-ID)
        (asserts! (map-get? tokens {token-id: token-id}) ERR-INVALID-TOKEN-ID)
        (let ((current-owner (unwrap-panic (map-get? tokens {token-id: token-id}))))
            (asserts! (is-eq sender current-owner) ERR-NOT-OWNER)
            (map-set tokens {token-id: token-id} recipient)
            (map-delete approvals {token-id: token-id})
            (print {type: "nft-transfer", token-id: token-id, from: sender, to: recipient})
            (ok true)
        )
    )
)

;; SIP-010: Get last token ID
(define-read-only (get-last-token-id)
    (var-get last-token-id)
)

;; SIP-010: Get token owner
(define-read-only (get-owner (token-id uint))
    (ok (unwrap! (map-get? tokens {token-id: token-id}) ERR-INVALID-TOKEN-ID))
)

;; Core Mint Function: Restricted to authorized minters (e.g., manufacturers)
(define-public (mint (token-id uint) (recipient principal) (meta {
    drug-type: (string-ascii 32),
    batch-id: uint,
    serial-number: (buff 16),
    expiration: uint,
    status: (string-ascii 16),
    manufacturer: principal,
    metadata-hash: (buff 32)
}))
    (begin
        (asserts! (is-admin tx-sender) ERR-NOT-AUTHORIZED)  ;; Only admin/minter for now
        (asserts! (not (map-get? tokens {token-id: token-id})) ERR-TOKEN-ALREADY-MINTED)
        (asserts! (validate-metadata meta) ERR-INVALID-METADATA)
        (asserts! (<= (len (get serial-number meta)) u16) ERR-METADATA-EXCEEDS-LIMIT)
        (asserts! (> (get expiration meta) block-height) ERR-INVALID-EXPIRATION)
        (map-set tokens {token-id: token-id} recipient)
        (map-insert metadata {token-id: token-id} meta)
        (var-set last-token-id (if (> token-id (var-get last-token-id)) token-id (var-get last-token-id)))
        (print {type: "nft-mint", token-id: token-id, recipient: recipient})
        (ok true)
    )
)

;; Approve transfer delegate
(define-public (set-approval (token-id uint) (spender principal))
    (begin
        (asserts! (is-owner token-id tx-sender) ERR-NOT-OWNER)
        (map-set approvals {token-id: token-id} spender)
        (print {type: "approval-set", token-id: token-id, spender: spender})
        (ok true)
    )
)

;; Transfer from approved spender
(define-public (transfer-from (token-id uint) (sender principal) (recipient principal))
    (begin
        (let ((approval (map-get? approvals {token-id: token-id})))
            (asserts! (or (is-some approval) (is-eq tx-sender sender)) ERR-NOT-AUTHORIZED)
            (asserts! (is-owner token-id sender) ERR-NOT-OWNER)
            (map-set tokens {token-id: token-id} recipient)
            (map-delete approvals {token-id: token-id})
            (print {type: "nft-transfer-from", token-id: token-id, from: sender, to: recipient})
            (ok true)
        )
    )
)

;; Update token status (e.g., from "active" to "redeemed")
(define-public (update-status (token-id uint) (new-status (string-ascii 16)))
    (let ((current-meta (unwrap! (map-get? metadata {token-id: token-id}) ERR-INVALID-TOKEN-ID))
          (owner (unwrap! (map-get? tokens {token-id: token-id}) ERR-INVALID-TOKEN-ID)))
        (asserts! (is-owner token-id tx-sender) ERR-NOT-OWNER)
        (asserts! (or (is-eq new-status "dispensed") (is-eq new-status "redeemed") (is-eq new-status "recalled")) ERR-INVALID-STATUS)
        (let ((updated-meta (merge current-meta {status: new-status})))
            (map-set metadata {token-id: token-id} updated-meta)
            (print {type: "status-update", token-id: token-id, new-status: new-status})
            (ok true)
        )
    )
)

;; Burn token (e.g., for recalled or redeemed doses)
(define-public (burn (token-id uint))
    (begin
        (asserts! (is-owner token-id tx-sender) ERR-NOT-OWNER)
        (let ((meta (unwrap! (map-get? metadata {token-id: token-id}) ERR-INVALID-TOKEN-ID)))
            (asserts! (not (is-eq (get status meta) "active")) ERR-INVALID-STATUS)  ;; Can't burn active
            (map-delete tokens {token-id: token-id})
            (map-delete metadata {token-id: token-id})
            (map-delete approvals {token-id: token-id})
            (print {type: "nft-burn", token-id: token-id})
            (ok true)
        )
    )
)

;; Read-only: Get full metadata
(define-read-only (get-metadata (token-id uint))
    (map-get? metadata {token-id: token-id})
)

;; Read-only: Check if token is expired
(define-read-only (is-expired (token-id uint))
    (let ((meta-opt (map-get? metadata {token-id: token-id})))
        (if (is-some meta-opt)
            (<= block-height (get expiration (unwrap-panic meta-opt)))
            false
        )
    )
)

;; Read-only: Get approval for token
(define-read-only (get-approval (token-id uint))
    (map-get? approvals {token-id: token-id})
)

;; Admin: Set new admin
(define-public (set-admin (new-admin principal))
    (begin
        (asserts! (is-admin tx-sender) ERR-NOT-AUTHORIZED)
        (var-set admin new-admin)
        (print {type: "admin-set", new-admin: new-admin})
        (ok true)
    )
)

;; Admin: Batch mint for a batch of doses
(define-public (batch-mint (start-id uint) (count uint) (recipient principal) (base-meta {
    drug-type: (string-ascii 32),
    batch-id: uint,
    expiration: uint,
    status: (string-ascii 16),
    manufacturer: principal
}) (serial-base (buff 16)))
    (begin
        (asserts! (is-admin tx-sender) ERR-NOT-AUTHORIZED)
        (asserts! (> count u0) ERR-INVALID-TOKEN-ID)
        (asserts! (validate-base-metadata base-meta) ERR-INVALID-METADATA)
        ;; Simplified loop simulation (Clarity doesn't have loops, but for batch, assume off-chain or recursive)
        ;; In practice, use recursive function or off-chain batching
        (let ((end-id (+ start-id (- count u1))))
            ;; Placeholder for batch logic; in full impl, recurse or use fold
            (print {type: "batch-mint", start: start-id, end: end-id, count: count})
            (ok {start-id: start-id, end-id: end-id})
        )
    )
)

;; Private: Validate base metadata for batch
(define-private (validate-base-metadata (base {
    drug-type: (string-ascii 32),
    batch-id: uint,
    expiration: uint,
    status: (string-ascii 16),
    manufacturer: principal
}))
    (and
        (>= (len (get drug-type base)) u1)
        (is-eq (get status base) "active")
        (> (get expiration base) block-height)
    )
)

;; SIP-010: Name
(define-read-only (get-name)
    (ok (var-get name))
)

;; SIP-010: Symbol
(define-read-only (get-symbol)
    (ok (var-get symbol))
)

;; Event for status change
;; Additional helpers for serialization compliance
(define-read-only (get-serial-number (token-id uint))
    (let ((meta-opt (map-get? metadata {token-id: token-id})))
        (if (is-some meta-opt)
            (ok (get serial-number (unwrap-panic meta-opt)))
            ERR-INVALID-TOKEN-ID
        )
    )
)

;; Verify metadata integrity via hash
(define-read-only (verify-metadata-hash (token-id uint) (provided-hash (buff 32)))
    (let ((meta-opt (map-get? metadata {token-id: token-id})))
        (if (is-some meta-opt)
            (let ((stored-hash (get metadata-hash (unwrap-panic meta-opt))))
                (if (is-eq stored-hash provided-hash)
                    (ok true)
                    ERR-INVALID-METADATA
                )
            )
            ERR-INVALID-TOKEN-ID
        )
    )
)