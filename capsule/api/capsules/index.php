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

if ($method === 'GET') {
    $stmt = $pdo->prepare("
        SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
               CASE WHEN c.open_date <= NOW() THEN 1 ELSE 0 END as is_open
        FROM capsules c
        LEFT JOIN contents ct ON c.id = ct.capsule_id
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
    ");
    $stmt->execute([$user_id]);
    $capsules = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($capsules as &$cap) {
        $cap['photo_urls'] = $cap['photo_urls'] ? json_decode($cap['photo_urls'], true) : [];
    }

    echo json_encode($capsules);

} elseif ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    
    $title = $data['title'] ?? '';
    $open_date = $data['open_date'] ?? '';
    $letter = $data['letter'] ?? '';
    $secret = $data['secret'] ?? '';
    $feeling = $data['feeling'] ?? 'happy';
    $rating = intval($data['rating'] ?? 0);
    $song = $data['song'] ?? '';
    $photo_urls = isset($data['photo_urls']) ? json_encode($data['photo_urls']) : '[]';

    if (!$title || !$open_date) {
        http_response_code(400);
        echo json_encode(['error' => 'Title and open date required']);
        exit;
    }

    try {
        $stmt = $pdo->prepare("INSERT INTO capsules (user_id, title, open_date) VALUES (?, ?, ?)");
        $stmt->execute([$user_id, $title, $open_date]);
        $capsule_id = $pdo->lastInsertId();

        $stmt = $pdo->prepare("
            INSERT INTO contents (capsule_id, letter, secret, feeling, rating, song, photo_urls)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$capsule_id, $letter, $secret, $feeling, $rating, $song, $photo_urls]);

        echo json_encode([
            'success' => true,
            'id' => $capsule_id,
            'message' => 'Capsule created successfully'
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create capsule: ' . $e->getMessage()]);
    }
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}