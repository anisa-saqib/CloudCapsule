<?php
$host = 'sql303.ezyro.com';
$dbname = 'ezyro_41198476_Cloudsdatabase';
$username = 'ezyro_41198476';
$password = '7w4kqx06';  // use your actual vPanel password

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}
?>