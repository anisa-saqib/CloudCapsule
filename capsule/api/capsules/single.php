<?php
header('Content-Type: application/json');
session_start();
require_once '../config/database.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$user_id = $_SESSION['user_id'];
$capsule_id = $_GET['id'] ?? null;

if (!$capsule_id) {
    http_response_code(400);
    echo json_encode(['error' => 'Capsule ID required']);
    exit;
}

if ($method === 'GET') {
    $stmt = $pdo->prepare("
        SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
               CASE WHEN c.open_date <= NOW() THEN 1 ELSE 0 END as is_open
        FROM capsules c
        LEFT JOIN contents ct ON c.id = ct.capsule_id
        WHERE c.id = ? AND c.user_id = ?
    ");
    $stmt->execute([$capsule_id, $user_id]);
    $capsule = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$capsule) {
        http_response_code(404);
        echo json_encode(['error' => 'Capsule not found']);
        exit;
    }

    $is_open = (new DateTime() >= new DateTime($capsule['open_date']));

    if (!$is_open) {
        // Locked capsule — hide all content
        $capsule['letter'] = null;
        $capsule['secret'] = null;
        $capsule['feeling'] = null;
        $capsule['rating'] = null;
        $capsule['song'] = null;
        $capsule['photo_urls'] = [];
    } else {
        // Open capsule — parse photo_urls, keep everything else
        $capsule['photo_urls'] = $capsule['photo_urls'] ? json_decode($capsule['photo_urls'], true) : [];
        // Letter, secret, feeling, rating, song are already in $capsule from the query
    }

    echo json_encode($capsule);

} elseif ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true);

    $stmt = $pdo->prepare("SELECT open_date FROM capsules WHERE id = ? AND user_id = ?");
    $stmt->execute([$capsule_id, $user_id]);
    $capsule = $stmt->fetch();

    if (!$capsule) {
        http_response_code(404);
        echo json_encode(['error' => 'Capsule not found']);
        exit;
    }

    if (new DateTime() >= new DateTime($capsule['open_date'])) {
        http_response_code(403);
        echo json_encode(['error' => 'Cannot edit an opened capsule']);
        exit;
    }

    $title = $data['title'] ?? '';
    $open_date = $data['open_date'] ?? '';

    if ($title && $open_date) {
        $stmt = $pdo->prepare("UPDATE capsules SET title = ?, open_date = ? WHERE id = ?");
        $stmt->execute([$title, $open_date, $capsule_id]);
    }

    $letter = $data['letter'] ?? '';
    $secret = $data['secret'] ?? '';
    $feeling = $data['feeling'] ?? 'happy';
    $rating = intval($data['rating'] ?? 0);
    $song = $data['song'] ?? '';
    $photo_urls = isset($data['photo_urls']) ? json_encode($data['photo_urls']) : '[]';

    $stmt = $pdo->prepare("
        UPDATE contents SET letter = ?, secret = ?, feeling = ?, rating = ?, song = ?, photo_urls = ? WHERE capsule_id = ?
    ");
    $stmt->execute([$letter, $secret, $feeling, $rating, $song, $photo_urls, $capsule_id]);

    echo json_encode(['success' => true, 'message' => 'Capsule updated']);

} elseif ($method === 'DELETE') {
    $stmt = $pdo->prepare("DELETE FROM capsules WHERE id = ? AND user_id = ?");
    $stmt->execute([$capsule_id, $user_id]);

    if ($stmt->rowCount() > 0) {
        echo json_encode(['success' => true, 'message' => 'Capsule deleted']);
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Capsule not found']);
    }

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
?>